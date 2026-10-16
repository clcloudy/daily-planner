// @vitest-environment node
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeAppData, todayKey } from '../src/core.mjs'
import { createSession, parseDays, parsePriority, runCommand, tokenize } from './commands.mjs'
import { DEFAULT_BINDINGS, buildLookup, loadBindings, normalizeKeyName } from './keys.mjs'
import { startServer } from './server.mjs'
import { daemonStatus, serviceFiles, startDaemon, stopDaemon } from './daemon.mjs'
import { buildHeatmap, focusMinutesByDay, heatLevel, monthLabels, renderHeatmap } from './heatmap.mjs'
import { defaultPlugins, loadPlugins, pluginEnabled, savePlugins } from './plugins.mjs'
import { createStore } from './store.mjs'
import { createTheme, stripAnsi, width } from './theme.mjs'
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

describe('专注热力图', () => {
  it('按本地日期汇总专注分钟并换算色阶', () => {
    const byDay = focusMinutesByDay([
      { id: 's1', date: '2025-01-01', minutes: 25 },
      { id: 's2', date: '2025-01-01', minutes: 30 },
      { id: 's3', date: '2025-01-02', minutes: 100 },
      { id: 's4', date: '2025-01-03', minutes: 0 },
      { id: 's5', date: '', minutes: 50 },
    ])
    expect(byDay.get('2025-01-01')).toBe(55)
    expect(byDay.has('2025-01-03')).toBe(false)
    expect(heatLevel(0)).toBe(0)
    expect(heatLevel(10)).toBe(1)
    expect(heatLevel(25)).toBe(2)
    expect(heatLevel(60)).toBe(3)
    expect(heatLevel(200)).toBe(4)
  })

  it('网格横轴为周、纵轴为星期，最后一列是本日所在周', () => {
    const now = new Date('2025-10-12T09:00:00') // 周日
    const grid = buildHeatmap(now, [], { weeks: 3 })
    expect(grid.columns).toHaveLength(3)
    expect(grid.columns.every((column) => column.length === 7)).toBe(true)
    expect(grid.columns[2][0].date).toBe('2025-10-12')
    expect(grid.columns[2][0].future).toBe(false)
    // 今天之后的星期留空，不参与统计。
    expect(grid.columns[2][1].future).toBe(true)
    // 月份标签按每格 2 列排布，与方块逐列对齐。
    expect(width(monthLabels(grid.columns))).toBe(3 * 2)
  })

  it('渲染结果不超出给定宽度并给出汇总', () => {
    const session = createSession(emptyStore())
    session.save({
      ...session.data,
      sessions: [
        { id: 's1', date: todayKey(), minutes: 10 },
        { id: 's2', date: todayKey(), minutes: 20 },
      ],
    })
    const lines = renderHeatmap(session, theme, { width: 80 })
    expect(lines.every((line) => width(line) <= 80)).toBe(true)
    expect(lines[0]).toContain('年度专注热力图')
    expect(lines.join('\n')).toContain('累计')
    expect(lines.join('\n')).toContain('30m')
  })

  it('格子彼此留有空隙，不会连成一片，月份标签与网格逐列对齐', () => {
    const session = createSession(emptyStore())
    const now = new Date('2026-10-17T09:00:00') // 周六
    session.save({
      ...session.data,
      sessions: [
        { id: 's1', date: '2026-10-12', minutes: 120 },
        { id: 's2', date: '2026-10-13', minutes: 60 },
        { id: 's3', date: '2026-10-14', minutes: 30 },
      ],
    })
    const lines = renderHeatmap({ ...session, now }, createTheme({ color: true }), { width: 80 })
    const monthRow = stripAnsi(lines[1])
    const gridRows = lines.slice(3, 10).map((line) => stripAnsi(line))

    // 有色终端一格只占上半行，纵向不会连成竖柱。
    for (const row of gridRows) expect(row).not.toContain('█')
    // 每格 2 列（方块 + 间隔），横向也不会出现两个方块紧挨着。
    expect(gridRows.join('')).not.toContain('▀▀')

    // 月份标签行与网格共用同一个左偏移，否则标签会整体错开一列。
    // 偏移按显示列算，星期标签「日」是全角 2 列。
    const displayColumn = (row, marker) => width(row.slice(0, row.indexOf(marker)))
    const cellColumn = displayColumn(gridRows[0], '▀')
    expect(cellColumn).toBe(3)
    expect(gridRows.every((row) => displayColumn(row, '▀') === cellColumn)).toBe(true)
    expect(displayColumn(monthRow, monthRow.trim()[0])).toBe(cellColumn)
  })

  it('今日页在空间足够时内嵌热力图，空间不足时省略', () => {
    const session = createSession(emptyStore())
    runCommand(session, 'add habit 晨间阅读 --days 每天')
    const roomy = renderBody(session, { theme, width: 100, height: 60, selected: -1 })
    expect(roomy.join('\n')).toContain('专注热力图')
    const tight = renderBody(session, { theme, width: 100, height: 12, selected: -1 })
    expect(tight.join('\n')).not.toContain('专注热力图')
  })
})

describe('插件开关', () => {
  it('默认状态可读取，配置文件只存与默认的差异', () => {
    const store = emptyStore()
    expect(defaultPlugins().heatmap).toBe(true)
    expect(pluginEnabled(loadPlugins(store.file), 'heatmap')).toBe(true)

    savePlugins(store.file, { heatmap: false })
    const saved = JSON.parse(fs.readFileSync(path.join(path.dirname(store.file), 'plugins.json'), 'utf8'))
    expect(saved.plugins).toEqual({ heatmap: false })
    expect(pluginEnabled(loadPlugins(store.file), 'heatmap')).toBe(false)

    savePlugins(store.file, { heatmap: true })
    const restored = JSON.parse(fs.readFileSync(path.join(path.dirname(store.file), 'plugins.json'), 'utf8'))
    expect(restored.plugins).toEqual({})
  })

  it('plugin 命令开关插件并控制热力图页面', () => {
    const store = emptyStore()
    const session = createSession(store)
    expect(runCommand(session, 'heatmap').page).toBe('heatmap')

    expect(runCommand(session, 'plugin heatmap off').ok).toBe(true)
    expect(pluginEnabled(loadPlugins(store.file), 'heatmap')).toBe(false)
    expect(session.plugins.heatmap).toBe(false)
    // 关掉插件后退回今日，直接跳转会失败。
    expect(session.page).toBe('today')
    expect(runCommand(session, 'heatmap').ok).toBe(false)

    expect(runCommand(session, 'plugin heatmap on').ok).toBe(true)
    expect(runCommand(session, 'heatmap').ok).toBe(true)
    expect(runCommand(session, 'plugin 不存在').ok).toBe(false)
  })
})

describe('后台常驻服务', () => {
  it('start 脱离终端启动，status 能发现，stop 能停掉', async () => {
    const store = emptyStore()
    const port = 20000 + (process.pid % 20000)
    try {
      const started = await startDaemon({ dataFile: store.file, port })
      expect(started.started).toBe(true)
      expect(started.pid).toBeGreaterThan(0)
      expect(fs.existsSync(serviceFiles(store.file).stateFile)).toBe(true)

      const status = await daemonStatus(store.file)
      expect(status.running).toBe(true)
      expect(status.record.pid).toBe(started.pid)
      expect(status.health?.port).toBe(started.port)

      const again = await startDaemon({ dataFile: store.file, port })
      expect(again.alreadyRunning).toBe(true)
      expect(again.started).toBe(false)

      const stopped = await stopDaemon(store.file)
      expect(stopped.stopped).toBe(true)
      expect((await daemonStatus(store.file)).running).toBe(false)
      expect(fs.existsSync(serviceFiles(store.file).stateFile)).toBe(false)
      // 已经停掉后再 stop 只是提示，不报错。
      expect((await stopDaemon(store.file)).stopped).toBe(false)
    } finally {
      await stopDaemon(store.file)
    }
  }, 30000)
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

    await send('\u0014') // ctrl-t 切换光标项
    expect(session.data.habits[0].logs).toEqual([todayKey()])
    await send('2')
    expect(session.page).toBe('habits')
    await send('3')
    expect(session.page).toBe('tasks')
    size.columns = 60
    size.rows = 18
    await send('\u000c') // ctrl-l 重绘
    await send('\u0010add task 从命令添加\r') // ctrl-p 打开命令行
    expect(session.data.tasks.map((task) => task.title)).toContain('从命令添加')
    await send('\u0007') // ctrl-g 帮助
    await send('j')
    await send('\u0011') // ctrl-q 退出
    await finished

    expect(writes.join('')).toContain('日常')
    expect(writes.join('')).toContain('ctrl-p 命令')
    expect(writes.join('')).toContain('j/k 移动')
    expect(writes.join('')).toContain('\u001b[?1049l')
  })

  it('待办用快捷键切换完成状态前需要确认', async () => {
    const session = createSession(emptyStore())
    runCommand(session, 'add task 整理笔记')
    session.page = 'tasks'

    const { writes, send, finished } = await mountTui(session)

    await send('\u0014') // ctrl-t 切换完成状态前先确认
    expect(writes.join('')).toContain('确认完成「整理笔记」')
    expect(session.data.tasks[0].done).toBe(false)

    // 误触后按别的键应当取消，不能改动数据。
    await send('n')
    expect(session.data.tasks[0].done).toBe(false)

    await send('\u0014')
    await send('y')
    expect(session.data.tasks[0].done).toBe(true)
    // 完成的待办仍然留在列表里。
    expect(pageItems(session).map((item) => item.task.title)).toEqual(['整理笔记'])

    await send('\u0011')
    await finished
  })

  it('专注结束后给出休息与结束两个选项，并发出提示音', async () => {
    const session = createSession(emptyStore())
    runCommand(session, 'add habit 晨间阅读 --days 每天')
    runCommand(session, 'add task 整理笔记')
    session.page = 'tasks'

    const { writes, send, finished } = await mountTui(session)

    // ctrl-f 打开专注目标选择器：自由专注 → 习惯 → 未完成待办。
    await send('\u0006')
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
    expect(text).toContain('ctrl-b 休息')
    expect(text).toContain('ctrl-e 结束本轮')
    // 时间到时发出提示音（终端响铃）。
    expect(text).toContain('\u0007')
    expect(session.data.sessions).toHaveLength(1)

    // 结束后不自动进入休息，按 ctrl-b 才休息。
    expect(session.data.timer.endAt).toBeNull()
    await send('\u0002')
    expect(session.data.timer.mode).toBe('break')
    expect(session.data.timer.endAt).toBeGreaterThan(Date.now())

    // 选「结束」时停在空闲状态，也不再自动进入休息。
    session.save({ ...session.data, timer: { mode: 'focus', endAt: Date.now() - 1 } })
    await new Promise((resolve) => setTimeout(resolve, 1400))
    await send('\u0005')
    expect(session.data.timer.endAt).toBeNull()
    expect(session.data.timer.mode).toBe('focus')
    expect(session.data.sessions).toHaveLength(2)

    await send('\u0011')
    await finished
  })

  it('TUI 里改键位后立即生效', async () => {
    const session = createSession(emptyStore())
    runCommand(session, 'add task 整理笔记')
    session.page = 'tasks'

    const { send, finished } = await mountTui(session)

    // ctrl-p 打开命令行，把退出改到 ctrl-w。
    await send('\u0010key quit ctrl-w\r')
    expect(loadBindings(session.store.file).quit).toEqual(['ctrl-w'])
    await send('\u0017') // ctrl-w 现在就是退出
    await finished
  })

  it('热力图作为插件页面可以开关', async () => {
    const session = createSession(emptyStore())
    runCommand(session, 'add habit 晨间阅读 --days 每天')

    const { writes, send, finished } = await mountTui(session)

    await send('\u000e') // ctrl-n 打开热力图
    expect(session.page).toBe('heatmap')
    expect(writes.join('')).toContain('年度专注热力图')

    await send('\u0010plugin heatmap off\r') // ctrl-p 关掉插件
    expect(session.plugins.heatmap).toBe(false)
    expect(session.page).toBe('today')
    await send('\u000e')
    expect(writes.join('')).toContain('专注热力图插件已关闭')

    await send('\u0011')
    await finished
  })
})

describe('键位', () => {
  it('默认把快捷指令绑到组合键，光标移动保留 j/k 与方向键', () => {
    expect(DEFAULT_BINDINGS.quit).toEqual(['ctrl-q'])
    expect(DEFAULT_BINDINGS.help).toEqual(['ctrl-g'])
    expect(DEFAULT_BINDINGS.command).toEqual(['ctrl-p'])
    expect(DEFAULT_BINDINGS.toggle).toEqual(['ctrl-t'])
    expect(DEFAULT_BINDINGS.add).toEqual(['ctrl-a'])
    expect(DEFAULT_BINDINGS.edit).toEqual(['ctrl-e'])
    expect(DEFAULT_BINDINGS.delete).toEqual(['ctrl-x'])
    expect(DEFAULT_BINDINGS.focus).toEqual(['ctrl-f'])
    expect(DEFAULT_BINDINGS.filter).toEqual(['ctrl-o'])
    expect(DEFAULT_BINDINGS.down).toEqual(['j', 'down'])
    expect(DEFAULT_BINDINGS.up).toEqual(['k', 'up'])
    // 保留键不占任何动作。
    const lookup = buildLookup(DEFAULT_BINDINGS)
    expect(lookup.get('ctrl-c')).toBeUndefined()
    expect(lookup.get('ctrl-d')).toBeUndefined()
    expect(lookup.get('ctrl-l')).toBeUndefined()
    expect(lookup.get('ctrl-q')).toBe('quit')
    expect(lookup.get('j')).toBe('down')
  })

  it('key 命令可以查看、修改、恢复键位并持久化', () => {
    const store = emptyStore()
    const session = createSession(store)

    // 不带参数展开帮助（快捷键表在帮助里）。
    expect(runCommand(session, 'key').help).toBe(true)
    expect(runCommand(session, 'key quit').message).toContain('ctrl-q')

    const bound = runCommand(session, 'key quit ctrl-w')
    expect(bound.ok).toBe(true)
    expect(bound.bindings.quit).toEqual(['ctrl-w'])
    // 重新读取文件后仍然生效。
    expect(loadBindings(store.file).quit).toEqual(['ctrl-w'])

    // 已被占用的键、保留键、无法识别的键、不存在的动作都要拒绝。
    const conflict = runCommand(session, 'key help ctrl-w')
    expect(conflict.ok).toBe(false)
    expect(conflict.message).toContain('已绑定给 quit')
    expect(runCommand(session, 'key quit ctrl-c').message).toContain('保留按键')
    expect(runCommand(session, 'key quit ctrl-1').ok).toBe(false)
    expect(runCommand(session, 'key quit 随便按').ok).toBe(false)
    expect(runCommand(session, 'key 不存在 ctrl-w').ok).toBe(false)
    // 拒绝后键位不被改动。
    expect(loadBindings(store.file).quit).toEqual(['ctrl-w'])

    // 命名键与大小写：G 和 g 是两个不同的键。
    expect(normalizeKeyName('Ctrl+Q')).toBe('ctrl-q')
    expect(normalizeKeyName('space')).toBe(' ')
    expect(normalizeKeyName('esc')).toBe('escape')
    expect(normalizeKeyName('G')).toBe('G')
    expect(runCommand(session, 'key bottom space').bindings.bottom).toEqual([' '])

    // 单个动作恢复默认与全部重置。
    runCommand(session, 'key bottom -')
    expect(loadBindings(store.file).bottom).toEqual(['G'])
    runCommand(session, 'key reset')
    expect(loadBindings(store.file).quit).toEqual(['ctrl-q'])
    expect(loadBindings(store.file).filter).toEqual(['ctrl-o'])
  })
})
