/**
 * TUI 键位表：动作 → 组合键。
 * 键位保存在数据文件同目录的 keys.json，只写与默认值的差异，
 * 因此网页版整份写入数据文件不会冲掉它；文件缺失或损坏时回退默认键位。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 任何模式下都直接占用，不允许绑定：随时退出与重绘。 */
export const RESERVED_KEYS = new Set(['ctrl-c', 'ctrl-d', 'ctrl-l'])

/** 命令里可写的命名键，统一成 parseKeys 产出的键名。 */
const KEY_ALIASES = {
  esc: 'escape',
  escape: 'escape',
  space: ' ',
  enter: 'enter',
  return: 'enter',
  tab: 'tab',
  backspace: 'backspace',
  del: 'delete',
  delete: 'delete',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  home: 'home',
  end: 'end',
  backtab: 'backtab',
}

/**
 * 可自定义的动作。快捷指令默认全部使用 ctrl 组合键，避免误触；
 * 光标移动保留 j/k 与方向键（导航不是指令，组合键反而不便）。
 */
export const ACTIONS = [
  { id: 'quit', label: '退出', keys: ['ctrl-q'] },
  { id: 'help', label: '帮助', keys: ['ctrl-g'] },
  { id: 'command', label: '命令输入', keys: ['ctrl-p'] },
  { id: 'toggle', label: '切换光标项', keys: ['ctrl-t'] },
  { id: 'add', label: '添加', keys: ['ctrl-a'] },
  { id: 'edit', label: '编辑光标项', keys: ['ctrl-e'] },
  { id: 'delete', label: '删除光标项', keys: ['ctrl-x'] },
  { id: 'focus', label: '专注', keys: ['ctrl-f'] },
  { id: 'reload', label: '重新读取数据', keys: ['ctrl-r'] },
  { id: 'filter', label: '切换待办筛选', keys: ['ctrl-o'] },
  { id: 'down', label: '下一项', keys: ['j', 'down'] },
  { id: 'up', label: '上一项', keys: ['k', 'up'] },
  { id: 'top', label: '第一项', keys: ['g'] },
  { id: 'bottom', label: '最后一项', keys: ['G'] },
  { id: 'next-page', label: '后一页', keys: ['tab', 'right'] },
  { id: 'prev-page', label: '前一页', keys: ['backtab', 'left'] },
  { id: 'page1', label: '今日页', keys: ['1'] },
  { id: 'page2', label: '习惯页', keys: ['2'] },
  { id: 'page3', label: '待办页', keys: ['3'] },
]

export const DEFAULT_BINDINGS = Object.freeze(
  Object.fromEntries(ACTIONS.map((action) => [action.id, Object.freeze([...action.keys])])),
)

export function keysFile(dataFile) {
  return path.join(path.dirname(dataFile), 'keys.json')
}

/** 把用户输入整理成 parseKeys 使用的键名；无法识别时返回 null。 */
export function normalizeKeyName(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  const alias = KEY_ALIASES[raw.toLowerCase()]
  if (alias) return alias
  const ctrl = raw.toLowerCase().match(/^(?:ctrl|control)[-+]([a-z])$/)
  if (ctrl) return `ctrl-${ctrl[1]}`
  if (raw.length === 1 && raw >= ' ') return raw
  return null
}

export function isBindableKey(name) {
  return Boolean(name) && !RESERVED_KEYS.has(name)
}

/** 读取键位：自定义内容覆盖默认值，无法识别的条目整条忽略。 */
export function loadBindings(dataFile) {
  const bindings = Object.fromEntries(ACTIONS.map((action) => [action.id, [...action.keys]]))
  let custom = {}
  try {
    const parsed = JSON.parse(fs.readFileSync(keysFile(dataFile), 'utf8'))
    if (parsed && typeof parsed === 'object' && parsed.bindings && typeof parsed.bindings === 'object') custom = parsed.bindings
  } catch {
    return bindings
  }
  for (const [action, keys] of Object.entries(custom)) {
    if (!(action in bindings) || !Array.isArray(keys)) continue
    const valid = [...new Set(keys.map((key) => normalizeKeyName(key)).filter(isBindableKey))]
    if (valid.length) bindings[action] = valid
  }
  return bindings
}

/** 只写与默认不同的部分：恢复默认等价于从文件里消失。 */
export function saveBindings(dataFile, bindings) {
  const diff = {}
  for (const action of ACTIONS) {
    const keys = bindings[action.id]
    if (!Array.isArray(keys) || !keys.length) continue
    if (keys.length !== action.keys.length || keys.some((key, index) => key !== action.keys[index])) diff[action.id] = keys
  }
  const file = keysFile(dataFile)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, bindings: diff }, null, 2)}\n`, 'utf8')
  return diff
}

/**
 * 键名 → 动作 的反查表。键位只在加载和修改时重建一次，
 * 之后每次按键都是一次 Map 查找，不随动作数增加而变慢。
 */
export function buildLookup(bindings) {
  const lookup = new Map()
  for (const action of ACTIONS) {
    for (const key of bindings[action.id] ?? []) {
      if (!lookup.has(key)) lookup.set(key, action.id)
    }
  }
  return lookup
}

/** 帮助文案里展示全部键位。 */
export function keyHint(bindings, action) {
  const keys = bindings?.[action] ?? DEFAULT_BINDINGS[action] ?? []
  return keys.join(' / ')
}

/** 状态栏等窄位置只展示第一个键。 */
export function keyLabel(bindings, action) {
  const keys = bindings?.[action] ?? DEFAULT_BINDINGS[action] ?? []
  return keys[0] ?? ''
}
