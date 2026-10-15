import { WEEKDAYS, dayKey, formatFocus } from '../src/core.mjs'
import { truncate, width } from './theme.mjs'

/**
 * 专注热力图：把 sessions 按天汇总成分钟数，再映射到 0–4 级颜色。
 * 网格横轴为周、纵轴为星期几（周日在最上），一格代表一天。
 */
export const HEATMAP_PAGE_ID = 'heatmap'

/** 分钟数到色阶的固定阈值，按常见番茄钟时长递进，便于跨天比较。 */
export const HEAT_THRESHOLDS = [25, 50, 100]
const BLOCKS = ['·', '░', '▒', '▓', '█']
const HEAT_CODES = [238, 22, 28, 34, 71]
export const HEAT_MAX_WEEKS = 53

/** 按本地日期汇总专注分钟，只保留正数，坏数据直接跳过。 */
export function focusMinutesByDay(sessions = []) {
  const byDay = new Map()
  for (const session of sessions) {
    if (!session || typeof session.date !== 'string') continue
    const minutes = Number(session.minutes)
    if (!Number.isFinite(minutes) || minutes <= 0) continue
    byDay.set(session.date, (byDay.get(session.date) ?? 0) + minutes)
  }
  return byDay
}

export function heatLevel(minutes, thresholds = HEAT_THRESHOLDS) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0
  let level = 1
  for (const threshold of thresholds) {
    if (minutes >= threshold) level += 1
  }
  return Math.min(level, BLOCKS.length - 1)
}

/** 有色终端用同一字形配不同绿色；无色终端用不同密度的块字符表达深浅。 */
function shade(theme, level) {
  const safe = Math.max(0, Math.min(level, BLOCKS.length - 1))
  if (!theme?.enabled) return BLOCKS[safe]
  return `\u001b[38;5;${HEAT_CODES[safe]}m${safe === 0 ? '·' : '█'}\u001b[0m`
}

/**
 * 生成最近 weeks 周的网格。最后一列是当前这一周（未来日期留空），
 * 每列从周日到周六共 7 格，日期用本地日历计算，避免时区偏移。
 */
export function buildHeatmap(now = new Date(), sessions = [], options = {}) {
  const weeks = Math.max(1, Math.min(HEAT_MAX_WEEKS, Math.floor(options.weeks ?? HEAT_MAX_WEEKS)))
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const byDay = focusMinutesByDay(sessions)
  const lastSunday = new Date(today)
  lastSunday.setDate(lastSunday.getDate() - lastSunday.getDay())
  const start = new Date(lastSunday)
  start.setDate(start.getDate() - (weeks - 1) * 7)

  const columns = []
  let total = 0
  let activeDays = 0
  let best = 0
  for (let week = 0; week < weeks; week += 1) {
    const column = []
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(start)
      date.setDate(start.getDate() + week * 7 + day)
      const future = date.getTime() > today.getTime()
      const key = dayKey(date)
      const minutes = future ? 0 : (byDay.get(key) ?? 0)
      if (!future && minutes > 0) {
        total += minutes
        activeDays += 1
        best = Math.max(best, minutes)
      }
      column.push({ date: key, day, minutes, future, level: future ? -1 : heatLevel(minutes) })
    }
    columns.push(column)
  }
  return { columns, weeks, start, end: today, total, activeDays, best }
}

/** 每月第一周上方标注月份；用单字符网格排布，保证与格子逐列对齐。 */
export function monthLabels(columns) {
  const cells = Array(columns.length).fill(' ')
  let previous = ''
  for (let week = 0; week < columns.length; week += 1) {
    const first = columns[week][0]
    const month = String(Number(first.date.slice(5, 7)))
    if (month === previous) continue
    previous = month
    let cursor = week
    for (const char of month) {
      if (cursor < cells.length && cells[cursor] === ' ') cells[cursor] = char
      cursor += 1
    }
  }
  return cells.join('')
}

export function renderHeatmap(state, theme, options = {}) {
  const contentWidth = options.width ?? 80
  const labelWidth = 2
  const weeks = Math.max(1, Math.min(HEAT_MAX_WEEKS, contentWidth - labelWidth))
  const grid = buildHeatmap(state.now ?? new Date(), state.data?.sessions ?? [], { weeks })
  const endDate = dayKey(grid.end)
  const title = `${theme.bold('年度专注热力图')} ${theme.faint(`过去 ${grid.weeks} 周 · 截至 ${endDate}`)}`

  const lines = [truncate(title, contentWidth)]
  lines.push(theme.faint(`${' '.repeat(labelWidth)}${monthLabels(grid.columns)}`))
  for (let day = 0; day < 7; day += 1) {
    const cells = grid.columns.map((column) => (column[day].future ? ' ' : shade(theme, column[day].level))).join('')
    lines.push(`${theme.faint(`${WEEKDAYS[day]} `)}${cells}`)
  }
  lines.push('')
  const legend = [
    `${theme.faint('少')} ${[0, 1, 2, 3, 4].map((level) => shade(theme, level)).join('')} ${theme.faint('多')}`,
    `${theme.muted('累计')} ${theme.bold(formatFocus(grid.total))}`,
    `${theme.muted('专注')} ${theme.bold(`${grid.activeDays} 天`)}`,
    `${theme.muted('单日最多')} ${theme.bold(formatFocus(grid.best))}`,
  ].join('   ')
  lines.push(truncate(legend, contentWidth))
  lines.push(truncate(theme.faint('每格代表一天 · 横轴为周、纵轴为星期几 · 颜色越深当天专注越久'), contentWidth))
  return lines
}

export { shade, width }
