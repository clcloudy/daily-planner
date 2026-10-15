/**
 * 后台常驻的本地同步服务。
 * 把 `daily serve` 脱离终端启动，并把 pid/端口写进数据文件同目录的
 * daily.service.json，便于 daemon stop / daemon status 管理。
 * 数据仍由 store 原子写入，和前台运行完全一致；不需要额外的常驻依赖。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeServer } from './server.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ENTRY = path.join(HERE, 'daily.mjs')
const ATTEMPTS = 10

export function serviceFiles(dataFile) {
  const dir = path.dirname(dataFile)
  return {
    dir,
    stateFile: path.join(dir, 'daily.service.json'),
    logFile: path.join(dir, 'daily.service.log'),
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function readService(dataFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(serviceFiles(dataFile).stateFile, 'utf8'))
    if (parsed && Number.isInteger(parsed.pid) && parsed.pid > 0) return parsed
  } catch {
    // 没有状态文件或内容损坏都当作“未运行”。
  }
  return null
}

export function writeService(dataFile, record) {
  const { dir, stateFile } = serviceFiles(dataFile)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(stateFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

export function clearService(dataFile) {
  try {
    fs.unlinkSync(serviceFiles(dataFile).stateFile)
  } catch {
    // 状态文件本来就不存在。
  }
}

/** pid 是否还活着；没有权限时按存活处理，避免误删别人的进程状态。 */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/** 服务可能占用 port..port+9 中的任意一个，逐个探测直到找到自己的数据文件。 */
async function waitForServer(dataFile, port, timeout = 6000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (let index = 0; index < ATTEMPTS; index += 1) {
      const health = await probeServer(port + index, dataFile).catch(() => null)
      if (health && !health.foreignFile) return { port: port + index, health }
    }
    await sleep(150)
  }
  return null
}

export async function daemonStatus(dataFile) {
  const record = readService(dataFile)
  if (!record) return { running: false, record: null }
  if (!isAlive(record.pid)) {
    clearService(dataFile)
    return { running: false, stale: true, record }
  }
  const health = await probeServer(record.port, dataFile).catch(() => null)
  return { running: true, record, health: health && !health.foreignFile ? health : null }
}

export async function startDaemon({ dataFile, port = 8787 } = {}) {
  const current = await daemonStatus(dataFile)
  if (current.running) return { started: false, alreadyRunning: true, status: current }
  const { dir, logFile } = serviceFiles(dataFile)
  fs.mkdirSync(dir, { recursive: true })
  const log = fs.openSync(logFile, 'a')
  let child
  try {
    child = spawn(process.execPath, [ENTRY, 'serve', '--data', dataFile, '--port', String(port)], {
      detached: true,
      stdio: ['ignore', log, log],
      windowsHide: true,
    })
  } finally {
    fs.closeSync(log)
  }
  child.unref()

  const found = await waitForServer(dataFile, port)
  if (!found) {
    try {
      process.kill(child.pid)
    } catch {
      // 进程可能已经自己退出。
    }
    return { started: false, failed: true, pid: child.pid, logFile, message: `后台服务启动失败，请查看日志：${logFile}` }
  }
  const record = { pid: child.pid, port: found.port, file: dataFile, startedAt: Date.now() }
  writeService(dataFile, record)
  return { started: true, ...record, health: found.health, logFile }
}

export async function stopDaemon(dataFile) {
  const record = readService(dataFile)
  if (!record) return { stopped: false, reason: 'not-running' }
  const alive = isAlive(record.pid)
  if (alive) {
    try {
      process.kill(record.pid, 'SIGTERM')
    } catch {
      // 已经退出。
    }
    const deadline = Date.now() + 3000
    while (Date.now() < deadline && isAlive(record.pid)) await sleep(100)
    // 极端情况下 Windows 上 SIGTERM 不一定生效，再用 taskkill 兜底。
    if (isAlive(record.pid) && process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(record.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      } catch {
        // 忽略：下面统一清理状态文件。
      }
      await sleep(300)
    }
  }
  clearService(dataFile)
  return { stopped: true, pid: record.pid, wasAlive: alive }
}
