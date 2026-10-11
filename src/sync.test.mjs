// @vitest-environment jsdom
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startServer } from '../cli/server.mjs'
import { createStore } from '../cli/store.mjs'
import { STORAGE_KEY, SYNC_META_KEY, normalizeAppData } from './data.ts'
import { createSyncClient } from './sync.ts'

const cleanups = []
let base = ''
let store

/** 用真实的 SSE 协议连接本地服务，替 jsdom 缺失的 EventSource。 */
class MockEventSource {
  constructor(url) {
    this.url = url
    this.listeners = new Map()
    this.buffer = ''
    const target = new URL(url, base)
    this.request = http.get({ hostname: target.hostname, port: target.port, path: target.pathname }, (response) => {
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        this.buffer += chunk
        let index = this.buffer.indexOf('\n\n')
        while (index !== -1) {
          const block = this.buffer.slice(0, index)
          this.buffer = this.buffer.slice(index + 2)
          const type = /^event: (.+)$/m.exec(block)?.[1]
          const data = /^data: (.+)$/m.exec(block)?.[1]
          if (type && data !== undefined) this.dispatch(type, { data })
          index = this.buffer.indexOf('\n\n')
        }
      })
    })
    setTimeout(() => this.dispatch('open', {}), 0)
  }

  addEventListener(type, handler) {
    const list = this.listeners.get(type) ?? []
    list.push(handler)
    this.listeners.set(type, list)
  }

  dispatch(type, event) {
    for (const handler of this.listeners.get(type) ?? []) handler(event)
  }

  close() {
    this.request?.destroy()
    this.request = null
  }
}

function waitFor(check, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - started > timeout) {
        clearInterval(timer)
        reject(new Error('waitFor 超时'))
      }
    }, 20)
  })
}

function meta() {
  return JSON.parse(localStorage.getItem(SYNC_META_KEY) ?? '{}')
}

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-sync-test-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  store = createStore(path.join(dir, 'data.json'))
  const server = await startServer({ store, port: 0 })
  base = `http://127.0.0.1:${server.port}`
  cleanups.push(() => server.close())

  const nodeFetch = globalThis.fetch
  // jsdom 的 AbortSignal 不是 Node fetch 认识的实例，测试里直接忽略中止信号。
  globalThis.fetch = (input, init) => nodeFetch(typeof input === 'string' ? new URL(input, base) : input, init ? { ...init, signal: undefined } : init)
  globalThis.EventSource = MockEventSource
  localStorage.clear()
})

afterEach(() => {
  while (cleanups.length) cleanups.pop()()
})

describe('网页版与命令行版的同步', () => {
  it('数据文件不存在时，用浏览器里的数据建立文件', async () => {
    const data = normalizeAppData({ tasks: [{ id: 't1', title: '浏览器里的待办', priority: 'high' }] })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    const statuses = []
    const client = createSyncClient({ onRemote: () => {}, onStatus: (status) => statuses.push(status) })
    cleanups.push(() => client.stop())
    client.start()
    // 网页版挂载时会把当前数据交给同步客户端，等价于下面这一行。
    client.push(data)

    await waitFor(() => store.read().exists)
    expect(store.read().data.tasks[0].title).toBe('浏览器里的待办')
    await waitFor(() => statuses.includes('synced'))
  })

  it('数据文件已存在时以文件为准，并把内容镜像回浏览器', async () => {
    store.write(normalizeAppData({ tasks: [{ id: 't9', title: '命令行里的待办' }] }))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeAppData({ tasks: [{ id: 't1', title: '过期的浏览器数据' }] })))
    const received = []
    const client = createSyncClient({ onRemote: (data) => received.push(data), onStatus: () => {} })
    cleanups.push(() => client.stop())
    client.start()

    await waitFor(() => received.length > 0)
    expect(received[0].tasks[0].title).toBe('命令行里的待办')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).tasks[0].title).toBe('命令行里的待办')
    expect(meta().dirty).toBe(false)
    // 没同步过的浏览器数据会被替换，但替换前留下备份。
    const backupKey = Object.keys(localStorage).find((key) => key.startsWith(`${STORAGE_KEY}-backup-`))
    expect(backupKey).toBeTruthy()
    expect(JSON.parse(localStorage.getItem(backupKey)).tasks[0].title).toBe('过期的浏览器数据')
  })

  it('命令行改动会通过 SSE 推送到网页版', async () => {
    store.write(normalizeAppData({ tasks: [{ id: 't1', title: '初始' }] }))
    const received = []
    const client = createSyncClient({ onRemote: (data) => received.push(data), onStatus: () => {} })
    cleanups.push(() => client.stop())
    client.start()
    await waitFor(() => meta().revision >= 1)

    store.update((data) => ({ ...data, tasks: [...data.tasks, { id: 't2', title: '终端新增', dueDate: '', priority: 'medium', done: false }] }))
    await waitFor(() => received.some((data) => data.tasks.some((task) => task.title === '终端新增')))
    expect(received.at(-1).tasks.map((task) => task.title)).toEqual(['初始', '终端新增'])
  })

  it('浏览器改动会写回数据文件', async () => {
    store.write(normalizeAppData({ tasks: [] }))
    const client = createSyncClient({ onRemote: () => {}, onStatus: () => {} })
    cleanups.push(() => client.stop())
    client.start()
    await waitFor(() => meta().revision >= 1)

    client.push(normalizeAppData({ tasks: [{ id: 't5', title: '浏览器新增', priority: 'low' }] }))
    await waitFor(() => store.read().data.tasks.some((task) => task.title === '浏览器新增'))
    expect(store.read().data.tasks[0].priority).toBe('low')
  })
})
