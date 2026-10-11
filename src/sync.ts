import { STORAGE_KEY, SYNC_META_KEY, normalizeAppData, type AppData } from './data'

export type SyncStatus = 'local' | 'connecting' | 'synced' | 'offline'

type SyncMeta = { revision: number; updatedAt: number; dirty: boolean }
type RemoteState = { exists: boolean; revision: number; updatedAt: number; data: AppData }

const emptyMeta: SyncMeta = { revision: 0, updatedAt: 0, dirty: false }
const RETRY_DELAYS = [2000, 5000, 10000, 20000, 30000]

function readMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY)
    if (!raw) return { ...emptyMeta }
    const parsed = JSON.parse(raw) as Partial<SyncMeta>
    return {
      revision: Number.isFinite(parsed.revision) ? Number(parsed.revision) : 0,
      updatedAt: Number.isFinite(parsed.updatedAt) ? Number(parsed.updatedAt) : 0,
      dirty: Boolean(parsed.dirty),
    }
  } catch {
    return { ...emptyMeta }
  }
}

function writeMeta(meta: SyncMeta) {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta))
  } catch {
    // 隐私模式下存储不可用，忽略即可。
  }
}

function writeLocal(data: AppData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // 同上。
  }
}

/** 只有从本地同步服务（而不是纯静态服务器或 file://）打开页面时才同步。 */
export function syncAvailable() {
  return typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol) && typeof EventSource !== 'undefined'
}

export type SyncClient = {
  start: () => void
  stop: () => void
  push: (data: AppData) => void
}

/**
 * 网页版与命令行版共用一份数据文件：
 * 首次握手决定以文件为准还是把浏览器数据写进文件，之后靠 SSE 双向推送。
 * 文件只由本地服务写入，浏览器始终保留 localStorage 作为离线兜底。
 */
export function createSyncClient(options: { onRemote: (data: AppData) => void; onStatus: (status: SyncStatus) => void }): SyncClient {
  let started = false
  let stopped = false
  let ready = false
  let source: EventSource | null = null
  let latest: AppData | null = null
  let inFlight = false
  let retryIndex = 0
  let retryTimer = 0
  let known = ''
  let meta = readMeta()

  const setStatus = options.onStatus

  function adopt(state: RemoteState) {
    const data = normalizeAppData(state.data)
    known = JSON.stringify(data)
    meta = { revision: state.revision, updatedAt: state.updatedAt, dirty: false }
    writeLocal(data)
    writeMeta(meta)
    latest = data
    options.onRemote(data)
  }

  async function flush() {
    if (inFlight || !ready || !latest) return
    const body = JSON.stringify(normalizeAppData(latest))
    if (body === known) {
      if (meta.dirty) {
        meta = { ...meta, dirty: false }
        writeMeta(meta)
      }
      return
    }
    inFlight = true
    try {
      const response = await fetch('/api/data', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
      })
      if (!response.ok) throw new Error(String(response.status))
      const result = (await response.json()) as { revision: number; updatedAt: number }
      known = body
      meta = { revision: result.revision, updatedAt: result.updatedAt, dirty: false }
      writeMeta(meta)
      setStatus('synced')
    } catch {
      meta = { ...meta, dirty: true }
      writeMeta(meta)
      setStatus('offline')
    } finally {
      inFlight = false
      if (latest && JSON.stringify(normalizeAppData(latest)) !== body) void flush()
    }
  }

  function openStream() {
    source?.close()
    const stream = new EventSource('/api/events')
    source = stream
    stream.addEventListener('open', () => {
      retryIndex = 0
      setStatus('synced')
      if (meta.dirty) void flush()
    })
    stream.addEventListener('data', (event) => {
      try {
        const state = JSON.parse((event as MessageEvent).data) as RemoteState
        if (meta.dirty || state.revision <= meta.revision) return
        adopt(state)
        setStatus('synced')
      } catch {
        // 无法解析的推送直接忽略。
      }
    })
    stream.addEventListener('error', () => setStatus('offline'))
  }

  async function connect() {
    if (stopped) return
    setStatus('connecting')
    let state: RemoteState
    try {
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), 1500)
      const response = await fetch('/api/data', { signal: controller.signal })
      window.clearTimeout(timer)
      if (response.status === 404) {
        setStatus('local')
        return
      }
      if (!response.ok) throw new Error(String(response.status))
      // 静态服务器（例如 vite dev）可能把未知路径回退成 index.html，这里只接受 JSON。
      if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
        setStatus('local')
        return
      }
      state = (await response.json()) as RemoteState
    } catch {
      if (stopped) return
      setStatus('offline')
      const delay = RETRY_DELAYS[Math.min(retryIndex, RETRY_DELAYS.length - 1)]
      retryIndex += 1
      retryTimer = window.setTimeout(() => void connect(), delay)
      return
    }
    if (stopped) return
    ready = true
    if (state.exists && !meta.dirty) {
      // 数据文件已存在：以文件为准。
      if (state.revision !== meta.revision) adopt(state)
      else setStatus('synced')
    } else {
      // 文件还没建立，或浏览器离线期间改过数据：把本地数据写进文件。
      await flush()
    }
    openStream()
  }

  return {
    start() {
      started = true
      if (!syncAvailable()) {
        setStatus('local')
        return
      }
      void connect()
    },
    stop() {
      stopped = true
      window.clearTimeout(retryTimer)
      source?.close()
      source = null
    },
    push(data: AppData) {
      latest = data
      if (!started || !ready) return
      void flush()
    },
  }
}
