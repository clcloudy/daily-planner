import { BREAK_MINUTES, FOCUS_MINUTES, createSession, summarize, todayKey } from '../src/core.mjs'
import { helpLines, pageItems, runCommand } from './commands.mjs'
import { PAGES, focusChoiceKey, focusChoices, renderBody, renderFocusPicker, renderHeader, renderTabs, timerSeconds } from './views.mjs'
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
  let pendingToggle = null
  let pickCursor = 0
  let bells = []
  let closed = false
  let ticker = null
  let finish = () => {}

  if (!session.message) session.message = session.exists ? '' : `还没有数据文件，当前显示的是示例数据：${session.file}`
  session.ok = session.ok !== false

  function size() {
    return { cols: Math.max(48, out.columns || 80), rows: Math.max(12, out.rows || 24) }
  }

  /** 终端响铃：隔开一点写多次，避免终端把连在一起的 \a 合并成一声。 */
  function bell(times = 3) {
    for (let index = 0; index < times; index += 1) {
      const handle = setTimeout(() => out.write('\u0007'), index * 240)
      bells.push(handle)
    }
  }

  function clearBells() {
    for (const handle of bells) clearTimeout(handle)
    bells = []
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

  function timerTarget() {
    const timer = session.data.timer
    if (timer.taskId) return session.data.tasks.find((task) => task.id === timer.taskId) ?? null
    if (timer.habitId) return session.data.habits.find((habit) => habit.id === timer.habitId) ?? null
    return null
  }

  function startTimer(kind, choice = null) {
    const minutes = kind === 'break' ? BREAK_MINUTES : FOCUS_MINUTES
    const timer = { mode: kind, endAt: Date.now() + minutes * 60000 }
    if (kind === 'focus' && choice?.kind === 'task') timer.taskId = choice.task.id
    if (kind === 'focus' && choice?.kind === 'habit') timer.habitId = choice.habit.id
    session.save({ ...session.data, timer })
    const suffix = choice && choice.kind !== 'free' ? `：${choice.title}` : kind === 'focus' ? '（自由专注）' : ''
    session.message = `${kind === 'break' ? '休息' : '专注'} ${minutes} 分钟开始${suffix}`
    session.ok = true
    ensureTicker()
  }

  function checkTimer() {
    const timer = session.data.timer
    if (!timer.endAt || Date.now() < timer.endAt) return
    if (timer.mode === 'focus') {
      const target = timerTarget()
      session.save({
        ...session.data,
        sessions: [...session.data.sessions, createSession({ minutes: FOCUS_MINUTES, taskId: timer.taskId, habitId: timer.habitId })],
        timer: { mode: 'focus', endAt: null },
      })
      // 专注结束后不再自动进入休息，交给使用者选「休息」或「结束」。
      mode = 'rest'
      session.message = `${target ? `专注完成：${target.title}` : '专注完成'}。b 休息 ${BREAK_MINUTES} 分钟 · e 结束本轮`
      session.ok = true
      bell(3)
    } else {
      session.save({ ...session.data, timer: { mode: 'focus', endAt: null } })
      session.message = '休息结束，可以开始下一个专注。'
      session.ok = true
      bell(2)
    }
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
    const bodyHeight = Math.max(3, rows - reserved)
    const body =
      mode === 'focus-pick'
        ? renderFocusPicker(session, theme, { width: contentWidth, cursor: pickCursor, rows: Math.max(3, bodyHeight - 4) }).slice(0, bodyHeight)
        : buildBody(contentWidth, bodyHeight)
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
    if (mode === 'toggle') {
      const task = pendingToggle?.task
      return { text: ` ${theme.yellow(`确认${task?.done ? '恢复' : '完成'}「${task?.title ?? ''}」？`)}${theme.faint('  y 确认 · 其它键取消')}`, column: 0 }
    }
    if (mode === 'focus-pick') return { text: ` ${theme.green('选择专注目标')}${theme.faint('  j/k 移动 · Enter 开始 · Esc 取消')}`, column: 0 }
    if (mode === 'rest') return { text: ` ${theme.yellow('专注完成，时间到！')}${theme.faint(`  b 休息 ${BREAK_MINUTES} 分钟 · e 结束本轮`)}`, column: 0 }
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
    const verbs = ['today', 'habits', 'tasks', 'check', 'add habit', 'add task', 'done', 'undone', 'pri', 'due', 'del task', 'del habit', 'rename habit', 'filter', 'focus start', 'focus break', 'focus stop', 'sync', 'export', 'import', 'where', 'help', 'quit']
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
    if (item.kind === 'habit') {
      setMessage(toggleHabit(item.habit))
      return
    }
    // 待办完成状态影响排序和统计，快捷键切换前先确认，避免误触。
    pendingToggle = item
    mode = 'toggle'
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
    const nextDone = !task.done
    session.save({ ...session.data, tasks: session.data.tasks.map((entry) => (entry.id === task.id ? { ...entry, done: nextDone } : entry)) })
    session.message = `${nextDone ? '已完成' : '已恢复'}：${task.title}`
    session.ok = true
    keepCursorOn(task.id)
  }

  /** 完成的待办会排到列表末尾，按 id 把光标跟过去，避免操作后跳行。 */
  function keepCursorOn(id) {
    const index = pageItems(session).findIndex((item) => item.id === id)
    if (index >= 0) session.cursor = index
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
      if (session.data.timer.endAt) {
        setMessage(runCommand(session, 'focus stop'))
        ensureTicker()
        return
      }
      openFocusPicker()
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

  function openFocusPicker() {
    const choices = focusChoices(session)
    const bound = focusChoiceKey(session.data.timer)
    const index = bound ? choices.findIndex((choice) => choice.id === bound) : -1
    pickCursor = index >= 0 ? index : 0
    mode = 'focus-pick'
  }

  function handleFocusKey(key) {
    const choices = focusChoices(session)
    if (key === 'escape' || key === 'q') {
      mode = 'normal'
      session.message = ''
      return
    }
    if (key === 'j' || key === 'down') {
      pickCursor = Math.min(choices.length - 1, pickCursor + 1)
      return
    }
    if (key === 'k' || key === 'up') {
      pickCursor = Math.max(0, pickCursor - 1)
      return
    }
    if (key === 'g' || key === 'home') {
      pickCursor = 0
      return
    }
    if (key === 'G' || key === 'end') {
      pickCursor = Math.max(0, choices.length - 1)
      return
    }
    if (key === 'enter' || key === ' ') {
      const choice = choices[pickCursor]
      mode = 'normal'
      if (choice) startTimer('focus', choice)
      return
    }
  }

  function handleRestKey(key) {
    if (key === 'b' || key === 'B' || key === 'enter' || key === '1') {
      mode = 'normal'
      startTimer('break')
      return
    }
    if (key === 'e' || key === 'E' || key === '2' || key === 'escape') {
      mode = 'normal'
      session.message = '本轮专注已结束，休息一下再看下一件事。'
      session.ok = true
      return
    }
    if (key === 'q' || key === 'ctrl-c' || key === 'ctrl-d') close()
  }

  function handleToggleKey(key) {
    const item = pendingToggle
    mode = 'normal'
    pendingToggle = null
    if (key === 'y' || key === 'Y') {
      if (item) setMessage(toggleTask(item.task))
      return
    }
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
      // 任何模式下都要能直接退出，否则弹窗会把使用者困住。
      if (key === 'ctrl-c' || key === 'ctrl-d') {
        close()
        return
      }
      if (mode === 'command') handleCommandKey(key)
      else if (mode === 'confirm') handleConfirmKey(key)
      else if (mode === 'toggle') handleToggleKey(key)
      else if (mode === 'rest') handleRestKey(key)
      else if (mode === 'focus-pick') handleFocusKey(key)
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
    clearBells()
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
