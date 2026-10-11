import { BREAK_MINUTES, FOCUS_MINUTES, createSession, summarize, todayKey } from '../src/core.mjs'
import { helpLines, pageItems, runCommand } from './commands.mjs'
import { PAGES, renderBody, renderHeader, renderTabs, timerSeconds } from './views.mjs'
import { truncate, width } from './theme.mjs'

const ALT_SCREEN_ON = '\u001b[?1049h'
const ALT_SCREEN_OFF = '\u001b[?1049l'
const CURSOR_ON = '\u001b[?25h'
const CURSOR_OFF = '\u001b[?25l'
const HOME = '\u001b[H'
const CLEAR_LINE = '\u001b[K'
const CLEAR_BELOW = '\u001b[J'

function parseKeys(chunk) {
  const text = chunk.toString('utf8')
  const keys = []
  let index = 0
  const escapeMap = {
    '\u001b[A': 'up',
    '\u001b[B': 'down',
    '\u001b[C': 'right',
    '\u001b[D': 'left',
    '\u001b[H': 'home',
    '\u001b[F': 'end',
    '\u001b[Z': 'backtab',
    '\u001b[3~': 'delete',
    '\u001b[1~': 'home',
    '\u001b[4~': 'end',
  }
  while (index < text.length) {
    if (text.startsWith('\u001b[200~', index)) {
      index += 6
      continue
    }
    if (text.startsWith('\u001b[201~', index)) {
      index += 6
      continue
    }
    const escape = Object.keys(escapeMap).find((sequence) => text.startsWith(sequence, index))
    if (escape) {
      keys.push(escapeMap[escape])
      index += escape.length
      continue
    }
    const char = String.fromCodePoint(text.codePointAt(index))
    index += char.length
    if (char === '\u001b') keys.push('escape')
    else if (char === '\r' || char === '\n') keys.push('enter')
    else if (char === '\u007f' || char === '\b') keys.push('backspace')
    else if (char === '\t') keys.push('tab')
    else if (char === '\u0003') keys.push('ctrl-c')
    else if (char === '\u0004') keys.push('ctrl-d')
    else if (char === '\u0015') keys.push('ctrl-u')
    else if (char === '\u0001') keys.push('home')
    else if (char === '\u0005') keys.push('end')
    else if (char === '\u000c') keys.push('redraw')
    else if (char < ' ') keys.push('ignore')
    else keys.push(char)
  }
  return keys
}

/**
 * 零依赖全屏 TUI：只在输入或数据变化时重绘，没有动画循环。
 * 番茄钟运行期间才启用 1 秒定时器，暂停时立即释放。
 */
export function startTui({ session, theme, status = () => '' }) {
  const out = process.stdout
  let mode = 'normal'
  let input = ''
  let inputCursor = 0
  let history = []
  let historyIndex = -1
  let confirmItem = null
  let closed = false
  let ticker = null
  let finish = () => {}

  if (!session.message) session.message = session.exists ? '' : `还没有数据文件，当前显示的是示例数据：${session.file}`
  session.ok = session.ok !== false

  function size() {
    return { cols: Math.max(48, out.columns || 80), rows: Math.max(12, out.rows || 24) }
  }

  function ensureTicker() {
    const running = Boolean(session.data.timer.endAt)
    if (running && !ticker) {
      ticker = setInterval(() => {
        session.now = new Date()
        checkTimer()
        paint()
      }, 1000)
    } else if (!running && ticker) {
      clearInterval(ticker)
      ticker = null
    }
  }

  function checkTimer() {
    const timer = session.data.timer
    if (!timer.endAt || Date.now() < timer.endAt) return
    if (timer.mode === 'focus') {
      session.save({
        ...session.data,
        sessions: [...session.data.sessions, createSession({ minutes: FOCUS_MINUTES, taskId: timer.taskId, habitId: timer.habitId })],
        timer: { mode: 'break', endAt: null },
      })
      session.message = `专注完成，休息 ${BREAK_MINUTES} 分钟吧。`
    } else {
      session.save({ ...session.data, timer: { mode: 'focus', endAt: null } })
      session.message = '休息结束，可以开始下一个专注。'
    }
    session.ok = true
    out.write('\u0007')
    ensureTicker()
  }

  function setMessage(result) {
    if (!result) return
    session.message = result.message ?? session.message
    session.ok = result.ok !== false
    if (result.page) {
      session.page = result.page
      if (result.resetCursor) session.cursor = 0
    }
    session.clampCursor()
  }

  function buildBody(contentWidth, contentHeight) {
    const items = pageItems(session)
    if (session.cursor >= items.length) session.cursor = Math.max(0, items.length - 1)
    const body = renderBody(session, { theme, width: contentWidth, selected: session.cursor })
    return body.slice(0, contentHeight)
  }

  function frame() {
    const { cols, rows } = size()
    const margin = cols >= 76 ? 2 : 1
    const contentWidth = Math.min(cols - margin * 2, 108)
    const indent = ' '.repeat(margin)
    const dateText = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(session.now)
    const lines = []
    lines.push('')
    lines.push(indent + renderHeader(session, theme, { width: contentWidth, dateText }))
    const tabs = renderTabs(session, theme)
    const statusText = status()
    lines.push(`${indent}${tabs}${' '.repeat(Math.max(1, contentWidth - width(tabs) - width(statusText)))}${theme.faint(statusText)}`)
    lines.push(indent + theme.sep('─'.repeat(contentWidth)))
    const reserved = 7
    const body = buildBody(contentWidth, Math.max(3, rows - reserved))
    for (const line of body) lines.push(indent + line)
    while (lines.length < rows - 2) lines.push('')
    const message = session.message ? (session.ok ? theme.green(session.message) : theme.red(session.message)) : ''
    lines.push(indent + truncate(message, contentWidth))
    return { lines, contentWidth, indent, message }
  }

  function commandBar(contentWidth) {
    if (mode === 'command') {
      const prefix = theme.green(' : ')
      const visible = truncate(input, Math.max(8, contentWidth - 6))
      return { text: `${prefix}${visible}`, column: 3 + Math.min(width(visible), width(input)) + 1 }
    }
    if (mode === 'help') return { text: theme.faint(' 任意键关闭帮助'), column: 0 }
    if (mode === 'confirm') return { text: ` ${theme.yellow(`确认删除「${confirmItem?.title ?? ''}」？`)}${theme.faint('  y 确认 · n 取消')}`, column: 0 }
    return { text: theme.faint(' : 命令   ? 帮助   j/k 移动   space 切换   a 添加   d 删除   f 专注   q 退出'), column: 0 }
  }

  function paint() {
    if (closed) return
    const { rows, cols } = size()
    const { lines, contentWidth, indent } = frame()
    const view = mode === 'help' ? helpLines(theme).map((line) => indent + line) : lines
    const visible = view.slice(0, rows - 1)
    while (visible.length < rows - 1) visible.push('')
    const bar = commandBar(contentWidth)
    let buffer = HOME
    for (const line of visible) buffer += `${truncate(line, cols)}${CLEAR_LINE}\r\n`
    buffer += `${truncate(bar.text, cols)}${CLEAR_LINE}${CLEAR_BELOW}`
    if (mode === 'command') buffer += `\u001b[${rows};${bar.column}H${CURSOR_ON}`
    else buffer += CURSOR_OFF
    out.write(buffer)
  }

  function complete(text) {
    const [verb] = text.trimStart().split(/\s+/)
    const verbs = ['today', 'habits', 'tasks', 'check', 'add habit', 'add task', 'done', 'undone', 'pri', 'due', 'del task', 'del habit', 'rename habit', 'filter', 'focus start', 'focus stop', 'sync', 'export', 'import', 'where', 'help', 'quit']
    const matches = verbs.filter((candidate) => candidate.startsWith(verb || ''))
    if (!verb) return text
    if (matches.length === 1) return `${matches[0]} `
    if (matches.length > 1) {
      session.message = matches.join('   ')
      session.ok = true
    }
    return text
  }

  function handleCommandKey(key) {
    if (key === 'escape') {
      mode = 'normal'
      input = ''
      return
    }
    if (key === 'enter') {
      const line = input.trim()
      mode = 'normal'
      input = ''
      inputCursor = 0
      if (!line) return
      history = [line, ...history.filter((item) => item !== line)].slice(0, 50)
      historyIndex = -1
      const result = runCommand(session, line)
      if (result.help) {
        mode = 'help'
        return
      }
      if (result.quit) {
        close()
        return
      }
      setMessage(result)
      ensureTicker()
      return
    }
    if (key === 'tab') {
      const completed = complete(input)
      if (completed !== input) {
        input = completed
        inputCursor = input.length
      }
      return
    }
    if (key === 'backspace') {
      if (inputCursor > 0) {
        input = input.slice(0, inputCursor - 1) + input.slice(inputCursor)
        inputCursor -= 1
      }
      return
    }
    if (key === 'delete') {
      input = input.slice(0, inputCursor) + input.slice(inputCursor + 1)
      return
    }
    if (key === 'left') {
      inputCursor = Math.max(0, inputCursor - 1)
      return
    }
    if (key === 'right') {
      inputCursor = Math.min(input.length, inputCursor + 1)
      return
    }
    if (key === 'home') {
      inputCursor = 0
      return
    }
    if (key === 'end') {
      inputCursor = input.length
      return
    }
    if (key === 'ctrl-u') {
      input = ''
      inputCursor = 0
      return
    }
    if (key === 'up') {
      if (history.length) {
        historyIndex = Math.min(history.length - 1, historyIndex + 1)
        input = history[historyIndex]
        inputCursor = input.length
      }
      return
    }
    if (key === 'down') {
      if (historyIndex > 0) {
        historyIndex -= 1
        input = history[historyIndex]
      } else {
        historyIndex = -1
        input = ''
      }
      inputCursor = input.length
      return
    }
    if (key.length === 1 && key >= ' ') {
      input = input.slice(0, inputCursor) + key + input.slice(inputCursor)
      inputCursor += 1
    }
  }

  function currentItem() {
    return pageItems(session)[session.cursor] ?? null
  }

  function toggleCurrent() {
    const item = currentItem()
    if (!item) return
    if (item.kind === 'habit') setMessage(toggleHabit(item.habit))
    else setMessage(toggleTask(item.task))
  }

  function toggleHabit(habit) {
    const today = todayKey()
    const has = habit.logs.includes(today)
    const logs = has ? habit.logs.filter((log) => log !== today) : [...habit.logs, today]
    session.save({ ...session.data, habits: session.data.habits.map((entry) => (entry.id === habit.id ? { ...entry, logs } : entry)) })
    session.message = `${has ? '已取消' : '已打卡'}：${habit.title}`
    session.ok = true
  }

  function toggleTask(task) {
    session.save({ ...session.data, tasks: session.data.tasks.map((entry) => (entry.id === task.id ? { ...entry, done: !entry.done } : entry)) })
    session.message = `${task.done ? '已恢复' : '已完成'}：${task.title}`
    session.ok = true
  }

  function handleNormalKey(key) {
    const items = pageItems(session)
    const pageIndex = PAGES.findIndex((page) => page.id === session.page)
    if (key === 'q' || key === 'ctrl-c' || key === 'ctrl-d') {
      close()
      return
    }
    if (key === 'escape') {
      session.message = ''
      return
    }
    if (key === '?' || key === 'F1') {
      mode = 'help'
      return
    }
    if (key === ':') {
      mode = 'command'
      input = ''
      inputCursor = 0
      return
    }
    if (key >= '1' && key <= '3') {
      session.page = PAGES[Number(key) - 1].id
      session.cursor = 0
      return
    }
    if (key === 'tab' || key === 'right' || key === 'l') {
      session.page = PAGES[(pageIndex + 1) % PAGES.length].id
      session.cursor = 0
      return
    }
    if (key === 'backtab' || key === 'left') {
      session.page = PAGES[(pageIndex + PAGES.length - 1) % PAGES.length].id
      session.cursor = 0
      return
    }
    if (key === 'j' || key === 'down') {
      session.cursor = Math.min(items.length - 1, session.cursor + 1)
      return
    }
    if (key === 'k' || key === 'up') {
      session.cursor = Math.max(0, session.cursor - 1)
      return
    }
    if (key === 'g') {
      session.cursor = 0
      return
    }
    if (key === 'G') {
      session.cursor = Math.max(0, items.length - 1)
      return
    }
    if (key === ' ' || key === 'enter') {
      toggleCurrent()
      return
    }
    if (key === 'a') {
      mode = 'command'
      input = session.page === 'habits' ? 'add habit ' : 'add task '
      inputCursor = input.length
      return
    }
    if (key === 'e') {
      const item = currentItem()
      if (item?.kind === 'habit') {
        mode = 'command'
        input = `rename habit ${item.habit.title} `
        inputCursor = input.length
      } else if (item?.kind === 'task') {
        mode = 'command'
        input = `due ${item.task.title} `
        inputCursor = input.length
      }
      return
    }
    if (key === 'd') {
      const item = currentItem()
      if (item) {
        confirmItem = { ...item, title: item.kind === 'habit' ? item.habit.title : item.task.title }
        mode = 'confirm'
      }
      return
    }
    if (key === 'f') {
      if (session.data.timer.endAt) setMessage(runCommand(session, 'focus stop'))
      else setMessage(runCommand(session, 'focus start'))
      ensureTicker()
      return
    }
    if (key === 'r') {
      reload(true)
      return
    }
    if (key === '=' || key === '+') {
      session.filter = session.filter === 'open' ? 'all' : session.filter === 'all' ? 'done' : 'open'
      session.cursor = 0
      return
    }
  }

  function handleConfirmKey(key) {
    if (key === 'y' || key === 'Y' || key === 'enter') {
      const target = confirmItem
      mode = 'normal'
      confirmItem = null
      if (!target) return
      const command = target.kind === 'habit' ? `del habit ${target.title}` : `del task ${target.title}`
      setMessage(runCommand(session, command))
      return
    }
    mode = 'normal'
    confirmItem = null
    session.message = ''
  }

  function reload(manual = false) {
    const previous = session.revision
    session.reload()
    if (manual) {
      session.message = session.revision === previous ? '数据已是最新。' : '已同步到最新数据。'
      session.ok = true
    } else if (session.revision !== previous) {
      session.message = '已同步命令行与网页版的数据。'
      session.ok = true
    }
  }

  function onData(chunk) {
    for (const key of parseKeys(chunk)) {
      if (key === 'redraw') {
        paint()
        continue
      }
      if (mode === 'help') {
        mode = 'normal'
        continue
      }
      if (mode === 'command') handleCommandKey(key)
      else if (mode === 'confirm') handleConfirmKey(key)
      else handleNormalKey(key)
      if (closed) return
    }
    ensureTicker()
    paint()
  }

  function onResize() {
    paint()
  }

  const unwatch = session.store.watch(() => {
    if (closed) return
    const current = session.store.read()
    if (current.revision === session.revision) return
    reload(false)
    paint()
  })

  function close() {
    if (closed) return
    closed = true
    if (ticker) clearInterval(ticker)
    unwatch()
    process.stdin.removeListener('data', onData)
    out.removeListener('resize', onResize)
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
    process.stdin.pause()
    out.write(`${CURSOR_ON}${ALT_SCREEN_OFF}`)
    finish()
  }

  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', onData)
  out.on('resize', onResize)
  out.write(`${ALT_SCREEN_ON}${CURSOR_OFF}${HOME}${CLEAR_BELOW}`)
  paint()
  ensureTicker()

  return new Promise((resolve) => {
    finish = resolve
    process.once('exit', close)
  })
}
