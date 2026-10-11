import {
  BREAK_MINUTES,
  FOCUS_MINUTES,
  WEEKDAYS,
  formatDays,
  formatDue,
  formatFocus,
  getCurrentStreak,
  summarize,
  todayKey,
  weekDates,
} from '../src/core.mjs'
import { pad, padStart, truncate, width } from './theme.mjs'

export const PAGES = [
  { id: 'today', label: '今日' },
  { id: 'habits', label: '习惯' },
  { id: 'tasks', label: '待办' },
]

export const TODAY_TASK_LIMIT = 8
export const TODAY_DONE_LIMIT = 3

/**
 * 待办始终留存：已完成的排在未完成之后，由渲染层置灰，不会被过滤掉。
 * filter 只决定“是否包含”已完成项，不改变留存与顺序。
 */
export function orderedTasks(tasks, filter = 'all') {
  if (filter === 'done') return tasks.filter((task) => task.done)
  const open = tasks.filter((task) => !task.done)
  if (filter === 'open') return open
  return [...open, ...tasks.filter((task) => task.done)]
}

export function filterTasks(data, filter) {
  return orderedTasks(data.tasks, filter)
}

/** 今日页要展示的待办：未完成优先，已完成留一小段灰色提示。 */
export function todayTasks(data, limit = TODAY_TASK_LIMIT, doneLimit = TODAY_DONE_LIMIT) {
  const open = data.tasks.filter((task) => !task.done).slice(0, limit)
  const done = data.tasks.filter((task) => task.done).slice(0, doneLimit)
  return [...open, ...done]
}

/** 当前页面里可以上下移动、用空格操作的项目。 */
export function pageItems(state) {
  const summary = summarize(state.data, state.now)
  if (state.page === 'habits') return state.data.habits.map((habit) => ({ kind: 'habit', id: habit.id, habit }))
  if (state.page === 'tasks') {
    return filterTasks(state.data, state.filter).map((task) => ({ kind: 'task', id: task.id, task }))
  }
  const items = summary.scheduledHabits.map((habit) => ({ kind: 'habit', id: habit.id, habit }))
  for (const task of todayTasks(state.data)) items.push({ kind: 'task', id: task.id, task })
  return items
}

export function timerSeconds(state) {
  const timer = state.data.timer
  if (timer.endAt) return Math.max(0, Math.ceil((timer.endAt - (state.now ?? new Date()).getTime()) / 1000))
  return (timer.mode === 'focus' ? FOCUS_MINUTES : BREAK_MINUTES) * 60
}

function clock(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function progressBar(seconds, total, size, theme) {
  const filled = Math.max(0, Math.min(size, Math.round(((total - seconds) / total) * size)))
  return `${theme.faint('[')}${theme.green('='.repeat(filled))}${theme.faint('-'.repeat(size - filled))}${theme.faint(']')}`
}

function sideBySide(left, right, leftWidth, gap = 4) {
  const rows = Math.max(left.length, right.length)
  const lines = []
  for (let index = 0; index < rows; index += 1) {
    const leftText = left[index] ?? ''
    const rightText = right[index] ?? ''
    if (!rightText.trim()) lines.push(leftText.replace(/\s+$/, ''))
    else lines.push(`${pad(leftText, leftWidth)}${' '.repeat(gap)}${rightText.replace(/\s+$/, '')}`)
  }
  return lines
}

function rule(size, theme) {
  return theme.sep('─'.repeat(Math.max(8, size)))
}

function cursorMark(active, theme) {
  return active ? theme.green('› ') : '  '
}

function habitLine(habit, { active, theme, today, titleWidth = 0 }) {
  const checked = habit.logs.includes(today)
  const box = checked ? theme.green('[x]') : theme.faint('[ ]')
  const rawTitle = checked ? theme.muted(habit.title) : habit.title
  const title = titleWidth ? pad(truncate(rawTitle, titleWidth), titleWidth) : rawTitle
  const streak = theme.yellow(`连续 ${getCurrentStreak(habit)} 天`)
  return `${cursorMark(active, theme)}${box} ${title}${titleWidth ? '  ' : ''}${streak}`
}

function taskLine(task, { active, theme, today, mark = true, titleWidth = 0 }) {
  const due = formatDue(task.dueDate, today)
  const overdue = task.dueDate && task.dueDate < today && !task.done
  const priority = task.priority === 'high' ? theme.red('高') : task.priority === 'low' ? theme.faint('低') : theme.yellow('中')
  const box = task.done ? theme.green('[x]') : mark ? theme.faint('[ ]') : '   '
  const rawTitle = task.done ? theme.muted(task.title) : task.title
  const title = titleWidth ? pad(truncate(rawTitle, titleWidth), titleWidth) : rawTitle
  const dueText = due ? (overdue ? theme.red(`${due} 逾期`) : theme.muted(due)) : ''
  return `${cursorMark(active, theme)}${box} ${title}  ${dueText}${dueText ? '  ' : ''}${priority}`
}

/** 列表里最长标题决定的列宽，保证日期、优先级能对齐。 */
function titleColumn(titles, max = 34, min = 14) {
  const longest = titles.reduce((best, title) => Math.max(best, width(title)), 0)
  return Math.max(min, Math.min(max, longest))
}

export { titleColumn }

export function summaryStrip(state, theme, size = 80) {
  const summary = summarize(state.data, state.now)
  const cell = (label, value, note) => `${theme.muted(label)} ${theme.bold(value)} ${theme.faint(note)}`
  const cells = [
    cell('今日习惯', `${summary.doneHabits.length}/${summary.scheduledHabits.length}`, `${summary.habitProgress}%`),
    cell('待办', String(summary.openTasks.length), summary.overdueTasks.length ? `${summary.overdueTasks.length} 件逾期` : '件待完成'),
    cell('专注', formatFocus(summary.focusMinutes), '今天累计'),
    cell('连续', `${summary.bestStreak} 天`, '最长打卡'),
  ]
  if (size >= 78) return [cells.join('   ')]
  return [cells.slice(0, 2).join('   '), cells.slice(2).join('   ')]
}

function todayBody(state, options) {
  const theme = options.theme
  const contentWidth = options.width
  const summary = summarize(state.data, state.now)
  const items = pageItems(state)
  const habits = summary.scheduledHabits
  const tasks = todayTasks(state.data)
  const habitIndex = new Map(items.map((item, index) => [`h:${item.id}`, index]))
  const taskIndex = new Map(items.map((item, index) => [`t:${item.id}`, index]))

  const habitLines = [theme.muted('习惯')]
  if (!habits.length) habitLines.push(theme.faint('  今天没有安排习惯，用 add habit 添加一个。'))
  const habitTitleWidth = titleColumn(habits.map((habit) => habit.title), 28)
  for (const habit of habits) {
    habitLines.push(habitLine(habit, { active: options.selected === habitIndex.get(`h:${habit.id}`), theme, today: summary.today, titleWidth: habitTitleWidth }))
  }

  const taskLines = [theme.muted('待办')]
  if (!tasks.length) taskLines.push(theme.faint('  没有未完成的待办，清爽的一天。'))
  const taskTitleWidth = titleColumn(tasks.map((task) => task.title), 30)
  for (const task of tasks) {
    taskLines.push(taskLine(task, { active: options.selected === taskIndex.get(`t:${task.id}`), theme, today: summary.today, titleWidth: taskTitleWidth }))
  }
  const remaining = summary.openTasks.length - tasks.filter((task) => !task.done).length
  if (remaining > 0) taskLines.push(theme.faint(`  还有 ${remaining} 件未完成…`))

  const seconds = timerSeconds(state)
  const total = (state.data.timer.mode === 'focus' ? FOCUS_MINUTES : BREAK_MINUTES) * 60
  const running = Boolean(state.data.timer.endAt)
  const focusTarget =
    (state.data.timer.taskId ? state.data.tasks.find((task) => task.id === state.data.timer.taskId) : null) ??
    (state.data.timer.habitId ? state.data.habits.find((habit) => habit.id === state.data.timer.habitId) : null)
  const focusLines = [
    theme.muted('专注'),
    `  ${progressBar(seconds, total, 20, theme)}  ${theme.bold(clock(seconds))}`,
    `  ${state.data.timer.mode === 'focus' ? '专注时间' : '休息时间'}${running ? theme.green(' · 进行中') : theme.faint(' · 已暂停')}`,
    `  ${theme.faint(focusTarget ? `目标：${focusTarget.title}` : '自由专注')}`,
    `  ${theme.faint(summary.todaySessions.length ? `今天已完成 ${summary.todaySessions.length} 个专注时段` : running ? '按 f 暂停计时' : '按 f 选择专注目标（习惯 / 待办）')}`,
  ]

  const lines = [...summaryStrip(state, theme, contentWidth), rule(contentWidth, theme)]
  if (contentWidth >= 88) {
    const leftWidth = Math.floor((contentWidth - 4) * 0.58)
    lines.push(...sideBySide([...habitLines, '', ...taskLines], focusLines, leftWidth))
  } else {
    lines.push(...habitLines, '', ...taskLines, '', ...focusLines)
  }
  return lines
}

function resolveHabit(state, key) {
  const list = pageItems(state)
  const indexMatch = key.match(/^#(\d+)$/)
  if (indexMatch) return list[Number(indexMatch[1]) - 1]?.habit ?? null
  const exact = state.data.habits.find((habit) => habit.id === key)
  if (exact) return exact
  const prefix = state.data.habits.filter((habit) => habit.id.startsWith(key))
  if (prefix.length === 1) return prefix[0]
  return state.data.habits.find((habit) => habit.title === key) ?? null
}

function resolveTask(state, key) {
  const list = pageItems(state)
  const indexMatch = key.match(/^#(\d+)$/)
  if (indexMatch) return list[Number(indexMatch[1]) - 1]?.task ?? null
  const exact = state.data.tasks.find((task) => task.id === key)
  if (exact) return exact
  const prefix = state.data.tasks.filter((task) => task.id.startsWith(key))
  if (prefix.length === 1) return prefix[0]
  const named = state.data.tasks.filter((task) => task.title === key)
  if (named.length >= 1) return named[0]
  const partial = state.data.tasks.filter((task) => task.title.includes(key))
  return partial.length === 1 ? partial[0] : null
}

export { resolveHabit, resolveTask }

function habitsBody(state, options) {
  const theme = options.theme
  const summary = summarize(state.data, state.now)
  const dates = weekDates(state.now)
  const items = pageItems(state)
  const index = new Map(items.map((item, position) => [item.id, position]))
  const titleWidth = titleColumn(state.data.habits.map((habit) => habit.title), Math.max(14, Math.min(28, options.width - 46)), 12)
  const streakWidth = 8
  const lines = [
    `  ${pad(theme.muted('习惯'), titleWidth)}${padStart(theme.muted('连续'), streakWidth)}   ${pad(theme.muted('本周'), 13)}${pad(theme.muted('状态'), 8)}${theme.muted('重复')}`,
    rule(options.width, theme),
  ]
  if (!state.data.habits.length) {
    lines.push(theme.faint('还没有习惯，用 add habit 名称 添加一个。'))
    return lines
  }
  for (const habit of state.data.habits) {
    const checked = habit.logs.includes(summary.today)
    const week = dates.map((date) => (habit.logs.includes(date) ? theme.green('x') : theme.faint('-'))).join(' ')
    const title = checked ? theme.muted(habit.title) : habit.title
    lines.push(
      `${cursorMark(options.selected === index.get(habit.id), theme)}${pad(truncate(title, titleWidth), titleWidth)}` +
        `${padStart(theme.yellow(`${getCurrentStreak(habit)} 天`), streakWidth)}   ${week}    ` +
        `${pad(checked ? theme.green('已打卡') : theme.faint('待打卡'), 8)}${theme.faint(formatDays(habit.days))}`,
    )
  }
  lines.push('', theme.faint(`今天 ${summary.doneHabits.length}/${summary.scheduledHabits.length} 已完成 · 按空格打卡 · 本周从周一开始`))
  return lines
}

function tasksBody(state, options) {
  const theme = options.theme
  const summary = summarize(state.data, state.now)
  const items = pageItems(state)
  const index = new Map(items.map((item, position) => [item.id, position]))
  const titleWidth = titleColumn(items.map((item) => item.task.title), Math.max(16, Math.min(40, options.width - 22)))
  const doneCount = state.data.tasks.filter((task) => task.done).length
  const tally = `${summary.openTasks.length} 件待处理 · ${doneCount} 件已完成`
  const lines = [
    `${['open', 'all', 'done'].map((filter) => (filter === state.filter ? theme.green(`[${filterLabel(filter)}]`) : theme.faint(` ${filterLabel(filter)} `))).join(' ')}   ${theme.faint(tally)}${summary.overdueTasks.length ? `   ${theme.red(`${summary.overdueTasks.length} 件逾期`)}` : ''}`,
    rule(options.width, theme),
  ]
  if (!items.length) {
    lines.push(theme.faint(state.filter === 'done' ? '还没有完成的事项。' : '没有符合条件的待办，用 add task 内容 添加一个。'))
    return lines
  }
  for (const item of items) {
    lines.push(taskLine(item.task, { active: options.selected === index.get(item.id), theme, today: summary.today, titleWidth }))
  }
  if (state.filter === 'open' && doneCount) lines.push('', theme.faint(`  已完成的 ${doneCount} 件在「全部」筛选里灰色留存。`))
  return lines
}

function filterLabel(filter) {
  return filter === 'open' ? '未完成' : filter === 'all' ? '全部' : '已完成'
}

/** 专注目标候选：自由专注 + 所有习惯 + 未完成待办。 */
export function focusChoices(state) {
  const choices = [{ kind: 'free', id: 'free', title: '自由专注', note: '不绑定目标' }]
  for (const habit of state.data.habits) {
    choices.push({ kind: 'habit', id: habit.id, habit, title: habit.title, note: '习惯' })
  }
  for (const task of state.data.tasks) {
    if (task.done) continue
    choices.push({ kind: 'task', id: task.id, task, title: task.title, note: '待办' })
  }
  return choices
}

/** 当前番茄钟绑定的是哪一项，用于在选择器里做标记。 */
export function focusChoiceKey(timer) {
  if (timer?.taskId) return timer.taskId
  if (timer?.habitId) return timer.habitId
  return ''
}

export function renderFocusPicker(state, theme, options = {}) {
  const width = options.width ?? 80
  const choices = focusChoices(state)
  const cursor = Math.max(0, Math.min(options.cursor ?? 0, choices.length - 1))
  const visible = Math.max(3, options.rows ?? 10)
  const start = Math.max(0, Math.min(cursor, choices.length - visible))
  const today = todayKey()
  const bound = focusChoiceKey(state.data.timer)
  const lines = [
    theme.bold('选择专注目标'),
    theme.faint(`  ${FOCUS_MINUTES} 分钟番茄钟 · j/k 移动 · Enter 开始 · Esc 取消`),
    rule(width, theme),
  ]
  const slice = choices.slice(start, start + visible)
  for (let offset = 0; offset < slice.length; offset += 1) {
    const choice = slice[offset]
    const active = start + offset === cursor
    const mark = active ? theme.green('› ') : '  '
    const tag = choice.kind === 'habit' ? theme.blue('习惯') : choice.kind === 'task' ? theme.green('待办') : theme.yellow('自由')
    const detail =
      choice.kind === 'habit'
        ? `${formatDays(choice.habit.days)} · 连续 ${getCurrentStreak(choice.habit)} 天`
        : choice.kind === 'task'
          ? `${formatDue(choice.task.dueDate, today) || '无截止'} · ${choice.task.priority === 'high' ? '高' : choice.task.priority === 'low' ? '低' : '中'}优先级`
          : choice.note
    const bullet = choice.id === bound ? theme.yellow('● ') : '  '
    lines.push(`${mark}${bullet}${tag} ${pad(truncate(choice.title, Math.max(8, width - 34)), Math.max(8, width - 34))}${theme.faint(detail)}`)
  }
  if (choices.length > visible) {
    lines.push(theme.faint(`  ${cursor + 1}/${choices.length} · 还有 ${choices.length - visible} 项可滚动`))
  }
  return lines
}

export function renderBody(state, options) {
  const page = state.page ?? 'today'
  const merged = { width: 80, selected: state.cursor ?? -1, ...options }
  if (page === 'habits') return habitsBody(state, merged)
  if (page === 'tasks') return tasksBody(state, merged)
  return todayBody(state, merged)
}

export function renderHeader(state, theme, options = {}) {
  const now = state.now ?? new Date()
  const left = `${theme.bold('日常')} ${theme.faint('daily')}`
  const right = `${theme.muted(options.dateText ?? '')}`
  const gap = Math.max(2, (options.width ?? 80) - width(left) - width(right))
  return `${left}${' '.repeat(gap)}${right}`
}

export function renderTabs(state, theme) {
  const active = state.page ?? 'today'
  return PAGES.map((page) => (page.id === active ? theme.green(page.label) : theme.faint(page.label))).join(theme.sep('  ·  '))
}

export { clock, progressBar, rule, sideBySide, taskLine, habitLine, filterLabel, WEEKDAYS }
