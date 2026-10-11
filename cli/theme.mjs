/** 极简配色与终端文本宽度工具（中英混排对齐靠它）。 */

const ANSI = /\u001b\[[0-9;]*m/g

export function stripAnsi(text) {
  return String(text).replace(ANSI, '')
}

/** 把带颜色的文本切成 [转义序列 | 单个可见字符]，宽度计算和截断都基于它。 */
function tokens(text) {
  const source = String(text)
  const result = []
  let index = 0
  while (index < source.length) {
    if (source[index] === '\u001b') {
      const match = /^\u001b\[[0-9;]*m/.exec(source.slice(index))
      if (match) {
        result.push({ ansi: match[0] })
        index += match[0].length
        continue
      }
    }
    const char = String.fromCodePoint(source.codePointAt(index))
    result.push({ char })
    index += char.length
  }
  return result
}

function codePointWidth(code) {
  if (code === 0) return 0
  if (code < 32 || (code >= 0x7f && code < 0xa0)) return 0
  if (code >= 0x0300 && code <= 0x036f) return 0
  if (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1f64f) ||
      (code >= 0x20000 && code <= 0x3fffd))
  ) {
    return 2
  }
  return 1
}

export function width(text) {
  let total = 0
  for (const token of tokens(text)) {
    if (!token.char) continue
    total += codePointWidth(token.char.codePointAt(0))
  }
  return total
}

export function pad(text, size) {
  const gap = size - width(text)
  return gap > 0 ? `${text}${' '.repeat(gap)}` : String(text)
}

export function padStart(text, size) {
  const gap = size - width(text)
  return gap > 0 ? `${' '.repeat(gap)}${text}` : String(text)
}

export function truncate(text, size) {
  if (width(text) <= size) return String(text)
  let result = ''
  let used = 0
  for (const token of tokens(text)) {
    if (!token.char) {
      result += token.ansi
      continue
    }
    const charWidth = codePointWidth(token.char.codePointAt(0))
    if (used + charWidth > size - 1) break
    result += token.char
    used += charWidth
  }
  return `${result}\u001b[0m…`
}

export function wrap(text, size) {
  const lines = []
  let line = ''
  let used = 0
  for (const token of tokens(text)) {
    if (!token.char) {
      line += token.ansi
      continue
    }
    const charWidth = codePointWidth(token.char.codePointAt(0))
    if (used + charWidth > size) {
      lines.push(line)
      line = ''
      used = 0
    }
    line += token.char
    used += charWidth
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

const CODES = {
  bold: '1',
  dim: '2',
  italic: '3',
  underline: '4',
  inverse: '7',
  accent: '38;5;71',
  green: '38;5;71',
  muted: '38;5;245',
  faint: '38;5;242',
  red: '38;5;174',
  yellow: '38;5;179',
  blue: '38;5;109',
  sep: '38;5;238',
}

function createStyler(enabled) {
  const styler = { enabled }
  for (const [name, code] of Object.entries(CODES)) {
    styler[name] = (text) => (enabled ? `\u001b[${code}m${text}\u001b[0m` : String(text))
  }
  return styler
}

/** 颜色输出三种情况：--no-color、NO_COLOR、非 TTY 管道。 */
export function createTheme({ color } = {}) {
  const enabled = color ?? (Boolean(process.stdout.isTTY) && !process.env.NO_COLOR)
  return createStyler(enabled)
}

export const plain = createStyler(false)
