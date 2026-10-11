import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeAppData } from '../src/core.mjs'

export const APP_ID = 'daily-planner'
export const DEFAULT_PORT = Number(process.env.DAILY_PLANNER_PORT) || 8787
/** 构建产物目录；被测试运行器打包时 import.meta.url 可能不是 file 协议，退回当前工作目录。 */
export const DIST_DIR = (() => {
  try {
    return fileURLToPath(new URL('../dist/', import.meta.url))
  } catch {
    return path.resolve(process.cwd(), 'dist')
  }
})()
const MAX_BODY = 5 * 1024 * 1024

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

function snapshot(store) {
  const current = store.read()
  return { exists: current.exists, revision: current.revision, updatedAt: current.updatedAt, data: current.data }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' })
  response.end(body)
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('payload too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]']

/**
 * 网页版可能从别的本地端口打开（例如 vite dev 的 5173），
 * 只对本地来源开放跨来源读写，其它网站既读不到也写不进来。
 */
function localOrigin(origin) {
  if (!origin) return null
  try {
    return LOCAL_HOSTS.includes(new URL(origin).hostname) ? origin : null
  } catch {
    return null
  }
}

function applyCors(request, response) {
  const allowed = localOrigin(request.headers.origin)
  if (!allowed) return null
  response.setHeader('access-control-allow-origin', allowed)
  response.setHeader('access-control-allow-methods', 'GET, PUT, OPTIONS')
  response.setHeader('access-control-allow-headers', 'content-type')
  response.setHeader('vary', 'Origin')
  return allowed
}

function serveStatic(request, response, root) {
  const url = new URL(request.url, 'http://127.0.0.1')
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)
  const target = path.resolve(root, `.${requested}`)
  if (!target.startsWith(path.resolve(root))) {
    sendJson(response, 403, { error: 'forbidden' })
    return
  }
  fs.stat(target, (error, stats) => {
    if (error || !stats.isFile()) {
      sendJson(response, 404, { error: 'not found' })
      return
    }
    response.writeHead(200, { 'content-type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
    fs.createReadStream(target).pipe(response)
  })
}

/** 探测目标端口上是否已经有一个使用同一数据文件的 daily-planner 服务。 */
export async function probeServer(port, file) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(700) })
    if (!response.ok) return null
    const health = await response.json()
    if (health.app !== APP_ID) return null
    if (file && health.file !== file) return { ...health, foreignFile: true }
    return health
  } catch {
    return null
  }
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening)
      if (error.code === 'EADDRINUSE') resolve(null)
      else reject(error)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolve(server)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

/**
 * 本地同步服务：只监听 127.0.0.1，提供数据读写接口、SSE 推送和网页版静态资源。
 * 数据文件由 store 统一写入，服务自己只负责转发变化。
 */
export async function startServer({ store, port = DEFAULT_PORT, host = '127.0.0.1', root = DIST_DIR, attempts = 10 }) {
  const clients = new Set()
  let lastRevision = null
  let closed = false

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? '127.0.0.1'}`)
    const cors = url.pathname.startsWith('/api/') ? applyCors(request, response) : null

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      response.writeHead(cors ? 204 : 403)
      response.end()
      return
    }

    if (url.pathname === '/api/health') {
      sendJson(response, 200, { ok: true, app: APP_ID, port: server.address()?.port ?? 0, file: store.file, clients: clients.size, version: 1, pid: process.pid, ...snapshot(store) })
      return
    }

    if (url.pathname === '/api/data') {
      if (request.method === 'GET') {
        sendJson(response, 200, snapshot(store))
        return
      }
      if (request.method === 'PUT') {
        const origin = request.headers.origin
        if (origin && !localOrigin(origin)) {
          sendJson(response, 403, { error: 'forbidden' })
          return
        }
        try {
          const body = await readBody(request)
          const parsed = JSON.parse(body)
          const payload = parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed
          const result = store.write(normalizeAppData(payload), 'web')
          sendJson(response, 200, result)
        } catch (error) {
          sendJson(response, 400, { error: error.message })
        }
        return
      }
      sendJson(response, 405, { error: 'method not allowed' })
      return
    }

    if (url.pathname === '/api/events') {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      response.write('retry: 2000\n\n')
      const payload = JSON.stringify(snapshot(store))
      response.write(`event: data\ndata: ${payload}\n\n`)
      clients.add(response)
      request.on('close', () => clients.delete(response))
      return
    }

    if (url.pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'not found' })
      return
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'method not allowed' })
      return
    }
    serveStatic(request, response, root)
  })

  server.on('connection', (socket) => socket.setNoDelay(true))

  let bound = null
  for (let index = 0; index < attempts; index += 1) {
    const candidate = port + index
    const result = await listen(server, candidate, host)
    if (result) {
      bound = server.address()?.port ?? candidate
      break
    }
  }
  if (bound === null) throw new Error(`端口 ${port}-${port + attempts - 1} 都被占用，无法启动本地同步服务。`)

  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(': ping\n\n')
  }, 25000)
  heartbeat.unref?.()

  const broadcast = () => {
    if (closed) return
    let current
    try {
      current = snapshot(store)
    } catch {
      return
    }
    if (current.revision === lastRevision) return
    lastRevision = current.revision
    const payload = JSON.stringify(current)
    for (const client of clients) client.write(`event: data\ndata: ${payload}\n\n`)
  }

  const watching = store.watch(() => broadcast())
  lastRevision = snapshot(store).revision

  return {
    port: bound,
    host,
    url: `http://${host}:${bound}/`,
    clients,
    broadcast,
    close() {
      closed = true
      watching()
      clearInterval(heartbeat)
      for (const client of clients) client.end()
      clients.clear()
      server.close()
    },
  }
}

/** TUI 或 serve 命令启动前调用：复用已存在的服务，避免重复占用内存。 */
export async function resolveServer({ store, port = DEFAULT_PORT, host = '127.0.0.1', root = DIST_DIR }) {
  for (let index = 0; index < 10; index += 1) {
    const health = await probeServer(port + index, store.file)
    if (health && !health.foreignFile) {
      const activePort = health.port || port + index
      return { reused: true, port: activePort, url: `http://${host}:${activePort}/`, server: null }
    }
  }
  const server = await startServer({ store, port, host, root })
  return { reused: false, port: server.port, url: server.url, server }
}
