import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DATA_FILE_VERSION, createStarterData, normalizeAppData } from '../src/core.mjs'

/** 默认数据文件：~/.daily-planner/data.json，可用 DAILY_PLANNER_DATA 覆盖。 */
export function defaultDataFile() {
  const override = process.env.DAILY_PLANNER_DATA
  if (override && override.trim()) return path.resolve(override.trim())
  return path.join(os.homedir(), '.daily-planner', 'data.json')
}

function atomicWrite(file, text) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`)
  fs.writeFileSync(tmp, text, 'utf8')
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(tmp, file)
      return
    } catch (error) {
      // Windows 上杀毒软件或文件监视可能短暂锁住目标文件。
      if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) {
        try {
          fs.unlinkSync(tmp)
        } catch {
          // 临时文件已经不存在。
        }
        throw error
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1))
    }
  }
}

/**
 * 数据文件同时服务于网页版和命令行版。
 * revision 每次写入递增，用来区分“别人的修改”和“自己刚写的内容”。
 */
export function createStore(file = defaultDataFile()) {
  const watchDir = path.dirname(file)

  function read() {
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { exists: false, revision: 0, updatedAt: 0, source: '', data: createStarterData() }
      }
      throw error
    }
    try {
      const parsed = JSON.parse(text)
      const payload = parsed && typeof parsed === 'object' && 'data' in parsed ? parsed : { data: parsed }
      return {
        exists: true,
        revision: Number.isFinite(payload.revision) ? payload.revision : 0,
        updatedAt: Number.isFinite(payload.updatedAt) ? payload.updatedAt : 0,
        source: typeof payload.source === 'string' ? payload.source : '',
        data: normalizeAppData(payload.data),
      }
    } catch {
      return { exists: true, corrupted: true, revision: 0, updatedAt: 0, source: '', data: createStarterData() }
    }
  }

  function write(data, source = 'cli') {
    const current = read()
    const payload = {
      version: DATA_FILE_VERSION,
      revision: (current.revision || 0) + 1,
      updatedAt: Date.now(),
      source,
      data: normalizeAppData(data),
    }
    if (current.corrupted) {
      try {
        fs.renameSync(file, `${file}.corrupt-${Date.now()}`)
      } catch {
        // 备份失败时不阻塞写入。
      }
    }
    atomicWrite(file, `${JSON.stringify(payload, null, 2)}\n`)
    return { revision: payload.revision, updatedAt: payload.updatedAt }
  }

  function update(mutator, source = 'cli') {
    const current = read()
    const next = mutator(current.data)
    return write(next ?? current.data, source)
  }

  /** 监听数据文件变化（网页版写入、命令行写入都会触发）。 */
  function watch(onChange) {
    fs.mkdirSync(watchDir, { recursive: true })
    const target = path.basename(file)
    let timer = null
    let closed = false
    const watcher = fs.watch(watchDir, (_event, changed) => {
      if (closed) return
      if (changed && path.basename(String(changed)) !== target) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        onChange()
      }, 50)
      timer.unref?.()
    })
    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      watcher.close()
    }
  }

  return { file, read, write, update, watch }
}
