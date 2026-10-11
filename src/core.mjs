/**
 * 共享数据层：网页版 (src/) 与命令行版 (cli/) 使用同一份数据模型和计算逻辑。
 * 这里保持纯 JavaScript、无依赖，浏览器和 Node 都能直接加载，避免两端逻辑漂移。
 */

export const STORAGE_KEY = 'daily-planner-v1'
export const SYNC_META_KEY = 'daily-planner-sync-v1'
export const DATA_FILE_VERSION = 1
export const HABIT_COLORS = ['mint', 'coral', 'yellow', 'lavender']
export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
export const FOCUS_MINUTES = 25
export const BREAK_MINUTES = 5

export function createId() {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 本地日历日期，避免 toISOString 带来的时区偏移。 */
export function dayKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayKey() {
  return dayKey(new Date())
}

/** 把 'today' / 'tomorrow' / '2025-6-5' 之类的输入解析成日期键。 */
export function parseDayInput(input, now = new Date()) {
  const text = String(input ?? '').trim()
  if (!text) return ''
  if (text === 'today' || text === '今天') return dayKey(now)
  if (text === 'tomorrow' || text === '明天') {
    const next = new Date(now)
    next.setDate(next.getDate() + 1)
    return dayKey(next)
  }
  const match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (!match) return null
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${match[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function isHabitScheduled(habit, day = new Date().getDay()) {
  return Array.isArray(habit.days) && habit.days.includes(day)
}

export function getCurrentStreak(habit, now = new Date()) {
  let streak = 0
  const cursor = new Date(now)
  cursor.setHours(0, 0, 0, 0)
  const logSet = new Set(habit.logs)
  while (logSet.has(dayKey(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** 本周一到周日的日期键，用于习惯页的周视图。 */
export function weekDates(now = new Date()) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now)
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + index)
    return dayKey(date)
  })
}

/** 每次调用都返回全新对象，避免调用方互相污染。 */
export function createStarterData() {
  const today = todayKey()
  return {
    habits: [
      { id: 'h1', title: '晨间阅读', days: [1, 2, 3, 4, 5, 6, 0], color: 'mint', logs: [] },
      { id: 'h2', title: '运动 30 分钟', days: [1, 3, 5, 6], color: 'coral', logs: [] },
      { id: 'h3', title: '写下今日复盘', days: [1, 2, 3, 4, 5, 0], color: 'yellow', logs: [] },
    ],
    tasks: [
      { id: 't1', title: '整理本周的灵感笔记', dueDate: today, priority: 'high', done: false },
      { id: 't2', title: '给阳台的植物浇水', dueDate: today, priority: 'low', done: false },
      { id: 't3', title: '读完《设计的心理学》一章', dueDate: '', priority: 'medium', done: false },
    ],
    sessions: [],
    timer: { mode: 'focus', endAt: null },
    nodes: [
      { id: 'n1', position: { x: 70, y: 140 }, data: { label: '学会日语' }, type: 'default' },
      { id: 'n2', position: { x: 350, y: 55 }, data: { label: '建立学习节奏', note: '每天留出一点时间' }, type: 'default' },
      { id: 'n3', position: { x: 350, y: 235 }, data: { label: '完成 N3 考试准备' }, type: 'default' },
      { id: 'n4', position: { x: 660, y: 140 }, data: { label: '报名考试' }, type: 'default' },
    ],
    edges: [
      { id: 'e1-2', source: 'n1', target: 'n2', animated: false },
      { id: 'e1-3', source: 'n1', target: 'n3', animated: false },
      { id: 'e3-4', source: 'n3', target: 'n4', animated: false },
    ],
  }
}

export const starterData = createStarterData()

const PRIORITIES = ['low', 'medium', 'high']

function normalizeHabit(value, index) {
  const habit = value && typeof value === 'object' ? value : {}
  return {
    id: typeof habit.id === 'string' && habit.id ? habit.id : `h-${index}`,
    title: typeof habit.title === 'string' ? habit.title : '未命名习惯',
    days: Array.isArray(habit.days) ? habit.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : [0, 1, 2, 3, 4, 5, 6],
    color: typeof habit.color === 'string' && habit.color ? habit.color : HABIT_COLORS[index % HABIT_COLORS.length],
    logs: Array.isArray(habit.logs) ? habit.logs.filter((log) => typeof log === 'string') : [],
  }
}

function normalizeTask(value, index) {
  const task = value && typeof value === 'object' ? value : {}
  return {
    id: typeof task.id === 'string' && task.id ? task.id : `t-${index}`,
    title: typeof task.title === 'string' ? task.title : '未命名待办',
    dueDate: typeof task.dueDate === 'string' ? task.dueDate : '',
    priority: PRIORITIES.includes(task.priority) ? task.priority : 'medium',
    done: Boolean(task.done),
  }
}

function normalizeSession(value, index) {
  const session = value && typeof value === 'object' ? value : {}
  return {
    id: typeof session.id === 'string' && session.id ? session.id : `s-${index}`,
    date: typeof session.date === 'string' ? session.date : todayKey(),
    minutes: Number.isFinite(session.minutes) ? session.minutes : 0,
    ...(typeof session.taskId === 'string' && session.taskId ? { taskId: session.taskId } : {}),
    ...(typeof session.habitId === 'string' && session.habitId ? { habitId: session.habitId } : {}),
  }
}

function normalizeTimer(value) {
  const timer = value && typeof value === 'object' ? value : {}
  const mode = timer.mode === 'break' ? 'break' : 'focus'
  const endAt = Number.isFinite(timer.endAt) ? timer.endAt : null
  return {
    mode,
    endAt,
    ...(typeof timer.taskId === 'string' && timer.taskId ? { taskId: timer.taskId } : {}),
    ...(typeof timer.habitId === 'string' && timer.habitId ? { habitId: timer.habitId } : {}),
  }
}

function normalizeNode(value, index) {
  const node = value && typeof value === 'object' ? value : {}
  const position = node.position && typeof node.position === 'object' ? node.position : {}
  const data = node.data && typeof node.data === 'object' ? node.data : {}
  return {
    id: typeof node.id === 'string' && node.id ? node.id : `n-${index}`,
    position: { x: Number(position.x) || 0, y: Number(position.y) || 0 },
    data: {
      label: typeof data.label === 'string' ? data.label : '新的想法',
      ...(typeof data.note === 'string' && data.note ? { note: data.note } : {}),
    },
    type: typeof node.type === 'string' ? node.type : 'default',
  }
}

function normalizeEdge(value, index) {
  const edge = value && typeof value === 'object' ? value : {}
  return {
    id: typeof edge.id === 'string' && edge.id ? edge.id : `e-${index}`,
    source: typeof edge.source === 'string' ? edge.source : '',
    target: typeof edge.target === 'string' ? edge.target : '',
    animated: Boolean(edge.animated),
  }
}

/**
 * 把任意来源（localStorage、数据文件、旧版本）的内容整理成当前数据模型。
 * 缺字段补默认值，坏字段丢弃，保证旧数据仍可打开。
 */
export function normalizeAppData(value) {
  const fallback = createStarterData()
  const source = value && typeof value === 'object' ? value : {}
  return {
    habits: Array.isArray(source.habits) ? source.habits.map(normalizeHabit) : fallback.habits,
    tasks: Array.isArray(source.tasks) ? source.tasks.map(normalizeTask) : fallback.tasks,
    sessions: Array.isArray(source.sessions) ? source.sessions.map(normalizeSession) : [],
    timer: normalizeTimer(source.timer),
    nodes: Array.isArray(source.nodes) ? source.nodes.map(normalizeNode) : fallback.nodes,
    edges: Array.isArray(source.edges) ? source.edges.map(normalizeEdge) : fallback.edges,
  }
}

export function createHabit({ title, days, color, index = 0 }) {
  return {
    id: createId(),
    title,
    days: days && days.length ? [...days].sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6],
    color: color || HABIT_COLORS[index % HABIT_COLORS.length],
    logs: [],
  }
}

export function createTask({ title, dueDate = '', priority = 'medium' }) {
  return { id: createId(), title, dueDate, priority: PRIORITIES.includes(priority) ? priority : 'medium', done: false }
}

export function createSession({ minutes = FOCUS_MINUTES, taskId, habitId, date = todayKey() }) {
  return {
    id: createId(),
    date,
    minutes,
    ...(taskId ? { taskId } : {}),
    ...(habitId ? { habitId } : {}),
  }
}

/** 同时被网页版和命令行版使用的派生数据。 */
export function summarize(data, now = new Date()) {
  const today = dayKey(now)
  const scheduled = data.habits.filter((habit) => isHabitScheduled(habit, now.getDay()))
  const done = scheduled.filter((habit) => habit.logs.includes(today))
  const openTasks = data.tasks.filter((task) => !task.done)
  return {
    today,
    scheduledHabits: scheduled,
    doneHabits: done,
    habitProgress: scheduled.length ? Math.round((done.length / scheduled.length) * 100) : 0,
    openTasks,
    overdueTasks: openTasks.filter((task) => task.dueDate && task.dueDate < today),
    doneTaskCount: data.tasks.filter((task) => task.done).length,
    focusMinutes: data.sessions.filter((session) => session.date === today).reduce((sum, session) => sum + session.minutes, 0),
    bestStreak: data.habits.reduce((best, habit) => Math.max(best, getCurrentStreak(habit, now)), 0),
    todaySessions: data.sessions.filter((session) => session.date === today),
  }
}

export function formatFocus(minutes) {
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${minutes}m`
}

export function dateLabel(date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(date)
}

export function greeting(now = new Date()) {
  const hour = now.getHours()
  return hour < 11 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
}

export function formatDue(dueDate, today = todayKey()) {
  if (!dueDate) return ''
  if (dueDate === today) return '今天'
  const diff = Math.round((new Date(`${dueDate}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000)
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  const [, month, day] = dueDate.split('-')
  return `${Number(month)}月${Number(day)}日`
}

export function formatDays(days) {
  if (!Array.isArray(days) || days.length === 7) return '每天'
  if (days.length === 0) return '未安排'
  return `每周 ${[...days].sort((a, b) => a - b).map((day) => WEEKDAYS[day]).join('、')}`
}
