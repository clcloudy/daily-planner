/**
 * TUI 插件注册表：可选功能的开关。
 * 插件状态写在数据文件同目录的 plugins.json（只存与默认值的差异），
 * 因此网页版整份写入 data.json 不会冲掉它，和 keys.json 一个思路。
 * 文件缺失或损坏时回退默认状态。
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * 可用插件。id 同时作为 plugins.json 里的键与命令参数；
 * defaultEnabled 决定没有配置文件时的初始状态。
 */
export const PLUGINS = [
  {
    id: 'heatmap',
    label: '专注热力图',
    description: '类似 GitHub 个人主页的年度专注时长热力图',
    defaultEnabled: true,
  },
]

export function pluginsFile(dataFile) {
  return path.join(path.dirname(dataFile), 'plugins.json')
}

export function defaultPlugins() {
  return Object.fromEntries(PLUGINS.map((plugin) => [plugin.id, plugin.defaultEnabled]))
}

/** 读取插件状态：自定义内容覆盖默认值，未知键与非法值忽略。 */
export function loadPlugins(dataFile) {
  const state = defaultPlugins()
  let custom = {}
  try {
    const parsed = JSON.parse(fs.readFileSync(pluginsFile(dataFile), 'utf8'))
    if (parsed && typeof parsed === 'object' && parsed.plugins && typeof parsed.plugins === 'object') custom = parsed.plugins
  } catch {
    return state
  }
  for (const [id, enabled] of Object.entries(custom)) {
    if (id in state && typeof enabled === 'boolean') state[id] = enabled
  }
  return state
}

/** 只写与默认不同的部分：恢复默认等价于从文件里消失。 */
export function savePlugins(dataFile, state) {
  const diff = {}
  for (const plugin of PLUGINS) {
    const enabled = state?.[plugin.id] ?? plugin.defaultEnabled
    if (enabled !== plugin.defaultEnabled) diff[plugin.id] = Boolean(enabled)
  }
  const file = pluginsFile(dataFile)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, plugins: diff }, null, 2)}\n`, 'utf8')
  return diff
}

export function findPlugin(id) {
  return PLUGINS.find((plugin) => plugin.id === id) ?? null
}

/** 状态里是否启用了某个插件；未知插件恒为关闭。 */
export function pluginEnabled(state, id) {
  const plugin = findPlugin(id)
  if (!plugin) return false
  const value = state?.[id]
  return typeof value === 'boolean' ? value : plugin.defaultEnabled
}
