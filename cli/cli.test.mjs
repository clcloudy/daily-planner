// @vitest-environment node
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeAppData, todayKey } from '../src/core.mjs'
import { createSession, parseDays, parsePriority, runCommand, tokenize } from './commands.mjs'
import { startServer } from './server.mjs'
import { createStore } from './store.mjs'
import { createTheme, width } from './theme.mjs'
import { pageItems, renderBody } from './views.mjs'

const theme = createTheme({ color: false })
const cleanups = []

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-planner-test-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return createStore(path.join(dir, 'data.json'))
}

/** 空数据文件，避免示例数据影响断言。 */
function emptyStore() {
  const store = tempStore()
  store.write(normalizeAppData({ habits: [], tasks: [] }))
  return store
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()()
})

describe('数据文件', () => {
  it('第一次写入时创建文件并记录修订号', () => {
    const store = tempStore()
    expect(store.read()).toMatchObject({ exists: false, revision: 0 })
    const result = store.write({ ...normalizeAppData({}), tasks: [] })
    expect(result.revision).toBe(1)
    const current = store.read()
    expect(current.exists).toBe(true)
    expect(current.revision).toBe(1)
    expect(current.data.tasks).toEqual([])
  })

  it('每次写入递增修订号，并整理坏字段', () => {
    const store = tempStore()
    store.write(normalizeAppData({}))
    const result = store.write({ habits: [{ title: '读书', days: [9, 1], logs: [1, '2025-01-01'] }], tasks: [{ title: 'x', priority: 'urgent' }] })
    expect(result.revision).toBe(2)
    const current = store.read()
    expect(current.data.habits[0].days).toEqual([1])
    expect(current.data.habits[0].logs).toEqual(['2025-01-01'])
    expect(current.data.tasks[0].priority).toBe('medium')
  })

  it('无法解析的文件标记为损坏而不是抛错', () => {
    const store = tempStore()
    fs.mkdirSync(path.dirname(store.file), { recursive: true })
    fs.writeFileSync(store.file, '{ this is not json')
    expect(store.read().corrupted).toBe(true)
  })
})

describe('命令解析', () => {
  it('解析带引号的参数', () => {
    expect(tokenize('add task "买牛奶 一盒" --due 明天')).toEqual(['add', 'task', '买牛奶 一盒', '--due', '明天'])
  })

  it('解析重复日期与优先级', () => {
    expect(parseDays('1,3,5')).toEqual([1, 3, 5])
    expect(parseDays('工作日')).toEqual([1, 2, 3, 4, 5])
    expect(parseDays('每天')).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(parseDays('星期九')).toBeNull()
    expect(parsePriority('高')).toBe('high')
    expect(parsePriority('低')).toBe('low')
    expect(parsePriority('紧急')).toBeNull()
  })
})

describe('命令执行', () => {
  it('新增、完成、删除待办都会写入数据文件', () => {
    const store = emptyStore()
    const session = createSession(store)
    expect(runCommand(session, 'add task 买牛奶 --due 明天 --priority 高').ok).toBe(true)
    const task = session.data.tasks[0]
    expect(task.title).toBe('买牛奶')
    expect(task.priority).toBe('high')
    expect(task.dueDate).not.toBe('')
    expect(store.read().data.tasks).toHaveLength(1)

    runCommand(session, 'done 买牛奶')
    expect(session.data.tasks[0].done).toBe(true)
    expect(store.read().data.tasks[0].done).toBe(true)

    runCommand(session, 'del task 买牛奶')
    expect(session.data.tasks).toHaveLength(0)
    expect(store.read().data.tasks).toHaveLength(0)
  })

  it('打卡会切换今天的状态并记录连续天数', () => {
    const store = emptyStore()
    const session = createSession(store)
    runCommand(session, 'add habit 晨间阅读 --days 每天')
    runCommand(session, 'check 晨间阅读')
    expect(session.data.habits[0].logs).toEqual([todayKey()])
    expect(runCommand(session, 'check 晨间阅读').message).toContain('已取消')
    expect(session.data.habits[0].logs).toEqual([])
  })

  it('专注计时器可以开始和暂停', () => {
    const store = emptyStore()
    const session = createSession(store)
    runCommand(session, 'focus start')
    expect(session.data.timer.endAt).toBeGreaterThan(Date.now())
    runCommand(session, 'focus stop')
    expect(session.data.timer.endAt).toBeNull()
  })

  it('未知命令返回失败信息', () => {
    const session = createSession(emptyStore())
    const result = runCommand(session, 'flying')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('未知命令')
  })

  it('筛选与页面切换不写入数据文件', () => {
    const store = emptyStore()
    const session = createSession(store)
    const before = store.read().revision
    runCommand(session, 'tasks')
    expect(session.page).toBe('tasks')
    runCommand(session, 'filter done')
    expect(session.filter).toBe('done')
    expect(store.read().revision).toBe(before)
  })
})

describe('页面渲染', () => {
  it('今日页包含习惯、待办与专注信息', () => {
    const session = createSession(emptyStore())
    runCommand(session, 'add habit 晨间阅读 --days 每天')
    runCommand(session, 'add task 整理笔记 --due 今天')
    const lines = renderBody(session, { theme, width: 100, selected: -1 })
    const text = lines.join('\n')
    expect(text).toContain('晨间阅读')
    expect(text).toContain('整理笔记')
    expect(text).toContain('专注')
    expect(text).toContain('今日习惯')
  })

  it('习惯页在窄终端下不会超出宽度', () => {
    const session = createSession(emptyStore())
    runCommand(session, 'add habit 晨间阅读 --days 每天')
    runCommand(session, 'add habit Read a book --days 工作日')
    runCommand(session, 'habits')
    const lines = renderBody(session, { theme, width: 100, selected: -1 })
    expect(lines.some((line) => line.includes('晨间阅读'))).toBe(true)
    expect(lines.some((line) => line.includes('Read a book'))).toBe(true)
    expect(lines.every((line) => width(line) <= 100)).toBe(true)
  })

  it('完成的待办会留存并排到未完成之后', () => {
    const session = createSession(emptyStore())
    runCommand(session, 'add habit 一个习惯')
    runCommand(session, 'add task 第一件')
    runCommand(session, 'add task 第二件')
    session.page = 'tasks'
    expect(pageItems(session).every((item) => item.kind === 'task')).toBe(true)
    runCommand(session, 'done 第二件')
    // 默认「全部」筛选：完成的待办仍然在列表里，只是排到后面置灰。
    expect(pageItems(session).map((item) => item.task.title)).toEqual(['第一件', '第二件'])
    expect(pageItems(session)[1].task.done).toBe(true)
    runCommand(session, 'filter open')
    expect(pageItems(session)).toHaveLength(1)
    runCommand(session, 'filter done')
    expect(pageItems(session)).toHaveLength(1)
  })

  it('专注目标可以选择习惯，并为待办设置目标', () => {
    const session = createSession(emptyStore())
    runCommand(session, 'add habit 晨间阅读 --days 每天')
    runCommand(session, 'add task 整理笔记')
    expect(runCommand(session, 'focus start 晨间阅读').ok).toBe(true)
    expect(session.data.timer.habitId).toBe(session.data.habits[0].id)
    expect(session.data.timer.taskId).toBeUndefined()
    expect(runCommand(session, 'focus start 整理笔记').ok).toBe(true)
    expect(session.data.timer.taskId).toBe(session.data.tasks[0].id)
    expect(runCommand(session, 'focus start 不存在的目标').ok).toBe(false)
  })
})

describe('本地同步服务', () => {
  it('读写接口与 SSE 推送保持一致', async () => {
    const store = tempStore()
    const server = await startServer({ store, port: 0 })
    cleanups.push(() => server.close())
    const base = `http://127.0.0.1:${server.port}`

    const health = await (await fetch(`${base}/api/health`)).json()
    expect(health.app).toBe('daily-planner')
    expect(health.file).toBe(store.file)

    const empty = await (await fetch(`${base}/api/data`)).json()
    expect(empty.exists).toBe(false)

    const events = []
    const stream = http.get(`${base}/api/events`, (response) => {
      response.setEncoding('utf8')
      response.on('data', (chunk) => events.push(chunk))
    })
    cleanups.push(() => stream.destroy())
    await new Promise((resolve) => setTimeout(resolve, 150))

    const payload = normalizeAppData({ tasks: [{ id: 't1', title: '来自接口', priority: 'high' }] })
    const put = await fetch(`${base}/api/data`, { method: 'PUT', body: JSON.stringify({ data: payload }), headers: { 'content-type': 'application/json' } })
    expect(put.status).toBe(200)
    const result = await put.json()
    expect(result.revision).toBe(1)

    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(events.join('')).toContain('event: data')
    expect(events.join('')).toContain('来自接口')
    expect(store.read().data.tasks[0].title).toBe('来自接口')
  })

  it('拒绝跨站写入', async () => {
    const server = await startServer({ store: tempStore(), port: 0 })
    cleanups.push(() => server.close())
    const response = await fetch(`http://127.0.0.1:${server.port}/api/data`, {
      method: 'PUT',
      body: JSON.stringify({ data: normalizeAppData({}) }),
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
    })
    expect(response.status).toBe(403)
  })

  it('允许本地其它端口的网页跨来源读写', async () => {
    const store = tempStore()
    const server = await startServer({ store, port: 0 })
    cleanups.push(() => server.close())
    const base = `http://127.0.0.1:${server.port}`

    const preflight = await fetch(`${base}/api/data`, { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:5173', 'access-control-request-method': 'PUT' } })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173')

    const put = await fetch(`${base}/api/data`, {
      method: 'PUT',
      body: JSON.stringify({ data: normalizeAppData({ tasks: [{ id: 't1', title: '来自开发页面' }] }) }),
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' },
    })
    expect(put.status).toBe(200)
    expect(store.read().data.tasks[0].title).toBe('来自开发页面')
  })
})

describe('交互界面', () => {
  /** 用假的 TTY 挂载 TUI，返回按键入口和写出的终端内容。 */
  async function mountTui(session) {
    const writes = []
    const originalWrite = process.stdout.write
    const originalStdin = process.stdin
    const stdin = new EventEmitter()
    stdin.isTTY = true
    stdin.setRawMode = () => {}
    stdin.resume = () => {}
    stdin.pause = () => {}
    stdin.setEncoding = () => {}
    const size = { columns: 100, rows: 30 }
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true })
    Object.defineProperty(process.stdout, 'write', { value: (chunk) => { writes.push(String(chunk)); return true }, configurable: true })
    Object.defineProperty(process.stdout, 'columns', { get: () => size.columns, configurable: true })
    Object.defineProperty(process.stdout, 'rows', { get: () => size.rows, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    cleanups.push(() => {
      Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true })
      Object.defineProperty(process.stdout, 'write', { value: originalWrite, configurable: true })
      delete process.stdout.columns
      delete process.stdout.rows
      delete process.stdout.isTTY
    })

    const { startTui } = await import('./tui.mjs')
    const finished = startTui({ session, theme, status: () => '测试' })
    const send = async (text) => {
      stdin.emit('data', text)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    return { writes, send, finished, stdin, theme, size }
  }

  it('按键操作会更新数据并在退出后恢复终端', async () => {
    const store = tempStore()
    const session = createSession(store)
    runCommand(session, 'add habit 晨间阅读 --days 每天')

    const { writes, send, finished, size } = await mountTui(session)

    await send(' ')
    expect(session.data.habits[0].logs).toEqual([todayKey()])
    await send('2')
    expect(session.page).toBe('habits')
    await send('3')
    expect(session.page).toBe('tasks')
    size.columns = 60
    size.rows = 18
    await send('\u000c')
    await send(':add task 从命令添加\r')
    expect(session.data.tasks.map((task) => task.title)).toContain('从命令添加')
    await send('?')
    await send('j')
    await send('q')
    await finished

    expect(writes.join('')).toContain('日常')
    expect(writes.join('')).toContain('\u001b[?1049l')
  })

  it('待办用快捷键切换完成状态前需要确认', async () => {
    const session = createSession(emptyStore())
    runCommand(session, 'add task 整理笔记')
    session.page = 'tasks'

    const { writes, send, finished } = await mountTui(session)

    await send(' ')
    expect(writes.join('')).toContain('确认完成「整理笔记」')
    expect(session.data.tasks[0].done).toBe(false)

    // 误触后按别的键应当取消，不能改动数据。
    await send('n')
    expect(session.data.tasks[0].done).toBe(false)

    await send(' ')
    await send('y')
    expect(session.data.tasks[0].done).toBe(true)
    // 完成的待办仍然留在列表里。
    expect(pageItems(session).map((item) => item.task.title)).toEqual(['整理笔记'])

    await send('q')
    await finished
  })

  it('专注结束后给出休息与结束两个选项，并发出提示音', async () => {
    const session = createSession(emptyStore())
    runCommand(session, 'add habit 晨间阅读 --days 每天')
    runCommand(session, 'add task 整理笔记')
    session.page = 'tasks'

    const { writes, send, finished } = await mountTui(session)

    // f 打开专注目标选择器：自由专注 → 习惯 → 未完成待办。
    await send('f')
    expect(writes.join('')).toContain('选择专注目标')
    await send('j')
    await send('\r')
    expect(session.data.timer.habitId).toBe(session.data.habits[0].id)
    expect(session.data.timer.endAt).toBeGreaterThan(Date.now())

    // 把倒计时直接推到终点，等 1 秒定时器触发专注完成。
    session.save({ ...session.data, timer: { ...session.data.timer, endAt: Date.now() - 1 } })
    await new Promise((resolve) => setTimeout(resolve, 1400))

    const text = writes.join('')
    expect(text).toContain('专注完成')
    expect(text).toContain('b 休息')
    expect(text).toContain('e 结束本轮')
    // 时间到时发出提示音（终端响铃）。
    expect(text).toContain('\u0007')
    expect(session.data.sessions).toHaveLength(1)

    // 结束后不自动进入休息，按 b 才休息。
    expect(session.data.timer.endAt).toBeNull()
    await send('b')
    expect(session.data.timer.mode).toBe('break')
    expect(session.data.timer.endAt).toBeGreaterThan(Date.now())

    // 选「结束」时停在空闲状态，也不再自动进入休息。
    session.save({ ...session.data, timer: { mode: 'focus', endAt: Date.now() - 1 } })
    await new Promise((resolve) => setTimeout(resolve, 1400))
    await send('e')
    expect(session.data.timer.endAt).toBeNull()
    expect(session.data.timer.mode).toBe('focus')
    expect(session.data.sessions).toHaveLength(2)

    await send('q')
    await finished
  })
})
