import fs from 'node:fs'
import path from 'node:path'
import {
  BREAK_MINUTES,
  FOCUS_MINUTES,
  createHabit,
  createTask,
  formatDays,
  getCurrentStreak,
  normalizeAppData,
  parseDayInput,
  todayKey,
} from '../src/core.mjs'
import { pageItems, resolveHabit, resolveTask } from './views.mjs'
import { pad } from './theme.mjs'

export function createSession(store, options = {}) {
  const initial = store.read()
  return {
    store,
    file: store.file,
    data: initial.data,
    revision: initial.revision,
    updatedAt: initial.updatedAt,
    exists: initial.exists,
    corrupted: Boolean(initial.corrupted),
    page: options.page ?? 'today',
    cursor: 0,
    // 待办默认显示全部：完成的项要留在列表里灰色显示，而不是凭空消失。
    filter: options.filter ?? 'all',
    now: new Date(),
    message: options.message ?? '',
    ok: true,
    reload() {
      const current = store.read()
      this.data = current.data
      this.revision = current.revision
      this.updatedAt = current.updatedAt
      this.exists = current.exists
      this.corrupted = Boolean(current.corrupted)
      this.clampCursor()
    },
    save(next) {
      const result = store.write(next)
      this.data = next
      this.revision = result.revision
      this.updatedAt = result.updatedAt
      this.exists = true
      this.clampCursor()
    },
    clampCursor() {
      const size = pageItems(this).length
      this.cursor = Math.max(0, Math.min(this.cursor, Math.max(0, size - 1)))
    },
  }
}

export function tokenize(line) {
  const tokens = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = pattern.exec(line))) tokens.push(match[1] ?? match[2] ?? match[3])
  return tokens
}

function extractFlags(tokens) {
  const flags = {}
  const rest = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.startsWith('--')) {
      const [name, inline] = token.slice(2).split('=')
      if (inline !== undefined) flags[name] = inline
      else {
        flags[name] = tokens[index + 1] ?? ''
        index += 1
      }
    } else {
      rest.push(token)
    }
  }
  return { flags, rest }
}

const DAY_NAMES = { 日: 0, 天: 0, 七: 0, sun: 0, 一: 1, mon: 1, 二: 2, tue: 2, 三: 3, wed: 3, 四: 4, thu: 4, 五: 5, fri: 5, 六: 6, sat: 6 }

export function parseDays(value) {
  if (value === undefined || value === null || value === '') return undefined
  const text = String(value).trim()
  if (['每天', 'all', 'daily', 'everyday'].includes(text)) return [0, 1, 2, 3, 4, 5, 6]
  if (['工作日', 'weekday', 'workday'].includes(text)) return [1, 2, 3, 4, 5]
  if (['周末', 'weekend'].includes(text)) return [6, 0]
  const days = []
  for (const part of text.split(/[,，、\s]+/).filter(Boolean)) {
    if (/^[0-6]$/.test(part)) days.push(Number(part))
    else if (DAY_NAMES[part.toLowerCase()] !== undefined) days.push(DAY_NAMES[part.toLowerCase()])
    else return null
  }
  return days.length ? [...new Set(days)].sort((a, b) => a - b) : null
}

export function parsePriority(value) {
  const text = String(value ?? '').toLowerCase()
  if (['high', 'h', '高', '高优先级', '1'].includes(text)) return 'high'
  if (['low', 'l', '低', '低优先级', '3'].includes(text)) return 'low'
  if (['medium', 'm', '中', '普通', '2'].includes(text)) return 'medium'
  return null
}

const PAGE_ALIASES = {
  today: 'today', t: 'today', 今日: 'today',
  habits: 'habits', habit: 'habits', h: 'habits', 习惯: 'habits',
  tasks: 'tasks', task: 'tasks', k: 'tasks', 待办: 'tasks',
}

function fail(message) {
  return { ok: false, message }
}

function done(session, message, extra = {}) {
  return { ok: true, message, ...extra }
}

function findNode(data, key) {
  const exact = data.nodes.find((node) => node.id === key)
  if (exact) return exact
  const prefix = data.nodes.filter((node) => node.id.startsWith(key))
  return prefix.length === 1 ? prefix[0] : null
}

export function helpLines(theme) {
  const head = (text) => theme.bold(text)
  const cmd = (text, description) => `  ${theme.green(pad(text, 32))}${theme.muted(description)}`
  const key = (text, description) => `  ${theme.green(pad(text, 32))}${theme.muted(description)}`
  return [
    head('页面'),
    cmd('today / t', '回到今日概览'),
    cmd('habits / h', '习惯打卡与周视图'),
    cmd('tasks / k', '待办清单（filter 切换筛选）'),
    '',
    head('习惯'),
    cmd('check <习惯>', '切换今天的打卡状态'),
    cmd('add habit <名称> [--days 1,2,3]', '新建习惯，可用 每天 / 工作日 / 周末'),
    cmd('rename habit <习惯> <新名称>', '重命名习惯'),
    cmd('del habit <习惯>', '删除习惯'),
    '',
    head('待办'),
    cmd('add task <内容>', '新建待办，可加 --due 明天 / --priority 高'),
    cmd('done <待办> / undone <待办>', '切换完成状态'),
    cmd('pri <待办> <高|中|低>', '调整优先级'),
    cmd('due <待办> <日期|->', '调整截止日期，- 表示清空'),
    cmd('del task <待办>', '删除待办'),
    '',
    head('专注'),
    cmd('focus start [习惯|待办]', '开始一个 25 分钟番茄钟，可绑定习惯或待办'),
    cmd('focus break', `开始 ${BREAK_MINUTES} 分钟休息`),
    cmd('focus stop', '结束当前计时器'),
    '',
    head('数据'),
    cmd('sync', '重新读取数据文件'),
    cmd('export [路径]', '导出 JSON 备份'),
    cmd('import <路径>', '从 JSON 备份恢复'),
    cmd('where', '显示数据文件位置'),
    '',
    head('快捷键'),
    key('1 / 2 / 3 · Tab', '切换页面'),
    key('j / k · ↑ / ↓', '移动光标'),
    key('f', '选择专注目标（习惯 / 待办 / 自由专注）'),
    key('space', '习惯直接打卡；待办会先确认再切换状态'),
    key('a · d · e', '添加 / 删除 / 编辑光标项'),
    key(':', '输入命令，Tab 补全，↑ ↓ 翻历史'),
    key('r · ? · q', '重新读取数据文件 · 帮助 · 退出'),
    '',
    theme.faint('  提示：#1 表示当前列表里的第一项；也可以用名称、ID 前缀或唯一标题片段。'),
    theme.faint('  提示：专注结束后按 b 休息，按 e 结束本轮。'),
  ]
}

function resolveHabitTarget(session, key, forceKind) {
  if (forceKind === 'habit') return resolveHabit({ ...session, page: 'habits' }, key)
  return resolveHabit(session, key)
}

function resolveTaskTarget(session, key) {
  return resolveTask({ ...session, page: 'tasks' }, key)
}

/** 专注目标既可以是待办，也可以是习惯（习惯用 habits 页的解析规则，避免待办遮蔽同名项）。 */
function resolveFocusTarget(session, key) {
  if (!key) return null
  return resolveTaskTarget(session, key) ?? resolveHabitTarget(session, key, 'habit')
}

export function runCommand(session, line) {
  const tokens = tokenize(line)
  if (!tokens.length) return { ok: true, message: '' }
  const { flags, rest } = extractFlags(tokens)
  const verb = rest[0].toLowerCase()
  const args = rest.slice(1)

  if (['help', '?', 'h?', 'keys'].includes(verb)) return { ok: true, message: '', help: true }
  if (['q', 'quit', 'exit'].includes(verb)) return { ok: true, message: '', quit: true }
  if (verb === 'where') return { ok: true, message: `数据文件：${session.file}` }
  if (verb === 'sync') {
    session.reload()
    return { ok: true, message: '已重新读取数据文件。' }
  }

  if (PAGE_ALIASES[verb]) {
    session.page = PAGE_ALIASES[verb]
    session.cursor = 0
    return { ok: true, message: '', page: session.page, resetCursor: true }
  }

  if (verb === 'filter') {
    const aliases = { open: 'open', 未完成: 'open', all: 'all', 全部: 'all', done: 'done', 已完成: 'done' }
    const next = aliases[args[0] ?? '']
    if (!next) return fail('用法：filter open|all|done')
    session.filter = next
    session.cursor = 0
    return done(session, `筛选：${next}`)
  }

  if (verb === 'check' || verb === 'uncheck' || verb === 'do' || verb === 'undo') {
    const key = args.join(' ')
    if (!key) return fail('用法：check <习惯>')
    const habit = resolveHabitTarget(session, key)
    if (!habit) return fail(`没有找到习惯「${key}」`)
    const today = todayKey()
    const has = habit.logs.includes(today)
    const shouldCheck = verb === 'check' || verb === 'do' ? !has : has
    const logs = shouldCheck ? [...habit.logs, today] : habit.logs.filter((log) => log !== today)
    session.save({ ...session.data, habits: session.data.habits.map((item) => (item.id === habit.id ? { ...item, logs } : item)) })
    return done(session, `${shouldCheck ? '已打卡' : '已取消'}：${habit.title} · 连续 ${getCurrentStreak({ ...habit, logs })} 天`)
  }

  if (verb === 'add' || verb === 'new') {
    const kind = (args[0] ?? '').toLowerCase()
    const title = args.slice(1).join(' ').trim()
    if (kind === 'habit' || kind === '习惯') {
      if (!title) return fail('用法：add habit <名称> [--days 1,2,3]')
      const days = parseDays(flags.days)
      if (days === null) return fail('--days 只接受 0-6、一/二/三…、每天、工作日、周末')
      const habit = createHabit({ title, days, color: flags.color, index: session.data.habits.length })
      session.save({ ...session.data, habits: [...session.data.habits, habit] })
      return done(session, `已添加习惯：${habit.title}（${formatDays(habit.days)}）`)
    }
    if (kind === 'task' || kind === 'todo' || kind === '待办') {
      if (!title) return fail('用法：add task <内容> [--due 明天] [--priority 高]')
      const dueInput = flags.due ?? ''
      const dueDate = dueInput ? parseDayInput(dueInput) : ''
      if (dueDate === null) return fail(`无法识别日期「${dueInput}」，可用 今天 / 明天 / 2025-06-05`)
      const priority = flags.priority ? parsePriority(flags.priority) : 'medium'
      if (!priority) return fail('--priority 只接受 高/中/低 或 high/medium/low')
      const task = createTask({ title, dueDate, priority })
      session.save({ ...session.data, tasks: [...session.data.tasks, task] })
      return done(session, `已添加待办：${task.title}${dueDate ? ` · ${dueDate}` : ''}`)
    }
    return fail('用法：add habit|task …')
  }

  if (verb === 'rename') {
    const kind = (args[0] ?? '').toLowerCase()
    if (kind === 'habit' || kind === '习惯') {
      const key = args[1]
      const title = args.slice(2).join(' ').trim()
      if (!key || !title) return fail('用法：rename habit <习惯> <新名称>')
      const habit = resolveHabitTarget(session, key, 'habit')
      if (!habit) return fail(`没有找到习惯「${key}」`)
      session.save({ ...session.data, habits: session.data.habits.map((item) => (item.id === habit.id ? { ...item, title } : item)) })
      return done(session, `已重命名：${title}`)
    }
    return fail('用法：rename habit <习惯> <新名称>')
  }

  if (verb === 'done' || verb === 'undone' || verb === 'todo' || verb === 'notdone') {
    const key = args.join(' ')
    if (!key) return fail('用法：done <待办>')
    const task = resolveTaskTarget(session, key)
    if (!task) return fail(`没有找到待办「${key}」`)
    const nextDone = verb === 'done' ? true : verb === 'undone' ? false : !task.done
    session.save({ ...session.data, tasks: session.data.tasks.map((item) => (item.id === task.id ? { ...item, done: nextDone } : item)) })
    return done(session, `${nextDone ? '已完成' : '已恢复'}：${task.title}`)
  }

  if (verb === 'pri' || verb === 'priority') {
    const key = args.slice(0, -1).join(' ')
    const priority = parsePriority(args[args.length - 1])
    if (!key || !priority) return fail('用法：pri <待办> <高|中|低>')
    const task = resolveTaskTarget(session, key)
    if (!task) return fail(`没有找到待办「${key}」`)
    session.save({ ...session.data, tasks: session.data.tasks.map((item) => (item.id === task.id ? { ...item, priority } : item)) })
    return done(session, `优先级已更新：${task.title} · ${priority}`)
  }

  if (verb === 'due') {
    const key = args.slice(0, -1).join(' ')
    const raw = args[args.length - 1]
    if (!key || raw === undefined) return fail('用法：due <待办> <日期|->')
    const task = resolveTaskTarget(session, key)
    if (!task) return fail(`没有找到待办「${key}」`)
    const dueDate = raw === '-' ? '' : parseDayInput(raw)
    if (dueDate === null) return fail(`无法识别日期「${raw}」`)
    session.save({ ...session.data, tasks: session.data.tasks.map((item) => (item.id === task.id ? { ...item, dueDate } : item)) })
    return done(session, `截止日期已更新：${task.title}${dueDate ? ` · ${dueDate}` : ' · 已清空'}`)
  }

  if (verb === 'del' || verb === 'rm' || verb === 'delete' || verb === 'remove') {
    const kind = ['habit', 'task', '习惯', '待办'].includes((args[0] ?? '').toLowerCase()) ? args[0].toLowerCase() : ''
    const key = (kind ? args.slice(1) : args).join(' ')
    if (!key) return fail('用法：del habit|task <项目>')
    if (kind === 'habit' || kind === '习惯') {
      const habit = resolveHabitTarget(session, key, 'habit')
      if (!habit) return fail(`没有找到习惯「${key}」`)
      session.save({ ...session.data, habits: session.data.habits.filter((item) => item.id !== habit.id) })
      return done(session, `已删除习惯：${habit.title}`)
    }
    if (kind === 'task' || kind === '待办') {
      const task = resolveTaskTarget(session, key)
      if (!task) return fail(`没有找到待办「${key}」`)
      session.save({ ...session.data, tasks: session.data.tasks.filter((item) => item.id !== task.id) })
      return done(session, `已删除待办：${task.title}`)
    }
    const habit = resolveHabitTarget(session, key, 'habit')
    if (habit) {
      session.save({ ...session.data, habits: session.data.habits.filter((item) => item.id !== habit.id) })
      return done(session, `已删除习惯：${habit.title}`)
    }
    const task = resolveTaskTarget(session, key)
    if (task) {
      session.save({ ...session.data, tasks: session.data.tasks.filter((item) => item.id !== task.id) })
      return done(session, `已删除待办：${task.title}`)
    }
    return fail(`没有找到「${key}」`)
  }

  if (verb === 'focus' || verb === 'pomo' || verb === 'timer') {
    const action = (args[0] ?? 'start').toLowerCase()
    if (['stop', 'reset'].includes(action)) {
      session.save({ ...session.data, timer: { mode: 'focus', endAt: null } })
      return done(session, '计时器已结束。')
    }
    if (action === 'break' || action === 'rest' || action === '休息') {
      session.save({ ...session.data, timer: { mode: 'break', endAt: Date.now() + BREAK_MINUTES * 60000 } })
      return done(session, `休息 ${BREAK_MINUTES} 分钟开始。`)
    }
    if (action === 'start') {
      const key = args.slice(1).join(' ')
      const task = key ? resolveTaskTarget(session, key) : null
      const habit = key && !task ? resolveHabitTarget(session, key, 'habit') : null
      if (key && !task && !habit) return fail(`没有找到专注目标「${key}」`)
      session.save({ ...session.data, timer: { mode: 'focus', endAt: Date.now() + FOCUS_MINUTES * 60000, ...(task ? { taskId: task.id } : {}), ...(habit ? { habitId: habit.id } : {}) } })
      const label = task ? `：${task.title}` : habit ? `：${habit.title}` : ''
      return done(session, `专注 ${FOCUS_MINUTES} 分钟开始${label}`)
    }
    if (action === 'target') {
      const key = args.slice(1).join(' ')
      const target = resolveFocusTarget(session, key)
      if (key && !target) return fail(`没有找到专注目标「${key}」`)
      const isTask = Boolean(target && session.data.tasks.some((task) => task.id === target.id))
      session.save({ ...session.data, timer: { ...session.data.timer, taskId: isTask ? target.id : undefined, habitId: target && !isTask ? target.id : undefined } })
      return done(session, target ? `专注目标：${target.title}` : '已设为自由专注。')
    }
    return fail('用法：focus start [习惯|待办] | focus break | focus stop')
  }

  if (verb === 'export') {
    const target = args[0] ? path.resolve(args[0]) : path.join(path.dirname(session.file), `daily-export-${todayKey()}.json`)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `${JSON.stringify(session.data, null, 2)}\n`, 'utf8')
    return done(session, `已导出：${target}`)
  }

  if (verb === 'import') {
    const source = args[0]
    if (!source) return fail('用法：import <路径>')
    const absolute = path.resolve(source)
    let parsed
    try {
      const raw = JSON.parse(fs.readFileSync(absolute, 'utf8'))
      parsed = raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw
    } catch (error) {
      return fail(`读取失败：${error.message}`)
    }
    session.save(normalizeAppData(parsed))
    return done(session, `已导入：${absolute}`)
  }

  if (verb === 'node' || verb === 'plan') {
    const action = (args[0] ?? '').toLowerCase()
    if (action === 'count') {
      return done(session, `长期规划：${session.data.nodes.length} 个节点 · ${session.data.edges.length} 条连接（请在网页版编辑）`)
    }
    const label = args.slice(1).join(' ').trim()
    if (action === 'add') {
      if (!label) return fail('用法：node add <名称>')
      const node = {
        id: `n-${Date.now().toString(36)}`,
        position: { x: 120 + (session.data.nodes.length % 3) * 90, y: 90 + session.data.nodes.length * 50 },
        data: { label },
        type: 'default',
      }
      session.save({ ...session.data, nodes: [...session.data.nodes, node] })
      return done(session, `已添加节点：${label}（可在网页版调整布局）`)
    }
    if (action === 'rename') {
      const node = findNode(session.data, args[1] ?? '')
      if (!node || !label) return fail('用法：node rename <节点> <名称>')
      session.save({ ...session.data, nodes: session.data.nodes.map((item) => (item.id === node.id ? { ...item, data: { ...item.data, label } } : item)) })
      return done(session, `已重命名节点：${label}`)
    }
    if (action === 'rm' || action === 'del') {
      const node = findNode(session.data, args[1] ?? '')
      if (!node) return fail('用法：node rm <节点 ID>')
      session.save({
        ...session.data,
        nodes: session.data.nodes.filter((item) => item.id !== node.id),
        edges: session.data.edges.filter((edge) => edge.source !== node.id && edge.target !== node.id),
      })
      return done(session, `已删除节点：${node.data.label}`)
    }
    return fail('规划图请在网页版编辑，这里只提供 node add|rename|rm|count')
  }

  if (verb === 'clear') return { ok: true, message: '' }

  return fail(`未知命令：${verb}。输入 help 查看全部命令。`)
}

export { pageItems, resolveHabit, resolveTask }
