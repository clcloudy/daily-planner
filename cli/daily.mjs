#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dateLabel, greeting } from '../src/core.mjs'
import { createSession, helpLines, runCommand } from './commands.mjs'
import { DEFAULT_BINDINGS, loadBindings } from './keys.mjs'
import { DIST_DIR, probeServer, resolveServer, startServer } from './server.mjs'
import { createStore, defaultDataFile } from './store.mjs'
import { createTheme, pad, width } from './theme.mjs'
import { startTui } from './tui.mjs'
import { renderBody, renderHeader } from './views.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const TUI_COMMANDS = new Set(['ui', 'tui', 'start'])
const SERVE_COMMANDS = new Set(['serve', 'server'])
const WEB_COMMANDS = new Set(['web', 'open'])

function parseArgv(argv) {
  const options = { color: undefined, data: null, port: Number(process.env.DAILY_PLANNER_PORT) || 8787, server: true, open: false }
  const rest = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--no-color') options.color = false
    else if (token === '--color') options.color = true
    else if (token === '--no-server') options.server = false
    else if (token === '--open') options.open = true
    else if (token === '--data') options.data = argv[++index]
    else if (token.startsWith('--data=')) options.data = token.slice(7)
    else if (token === '--port') options.port = Number(argv[++index]) || options.port
    else if (token.startsWith('--port=')) options.port = Number(token.slice(7)) || options.port
    else if (token === '-h' || token === '--help') rest.unshift('help')
    else if (token === '-v' || token === '--version') rest.unshift('version')
    else rest.push(token)
  }
  return { options, rest }
}

function printPage(session, theme, page, bindings = DEFAULT_BINDINGS) {
  if (page) session.page = page
  const width = Math.min((process.stdout.columns || 84) - 2, 100)
  const now = session.now
  const dateText = `${dateLabel(now)} · ${greeting(now)}`
  const lines = [
    renderHeader(session, theme, { width, dateText }),
    theme.sep('─'.repeat(width)),
    ...renderBody(session, { theme, width, selected: -1, keys: bindings }),
  ]
  process.stdout.write(`${lines.join('\n').replace(/\s+$/, '')}\n`)
}

function printInfo(theme, session, serverInfo) {
  const rows = [
    ['数据文件', session.file],
    ['文件状态', session.exists ? `存在 · 修订 ${session.revision}` : '尚未创建，执行任意写操作后自动创建'],
    ['同步服务', serverInfo ? serverInfo.url : '未启动（用 daily serve 或直接运行 daily）'],
    ['网页版', fs.existsSync(path.join(DIST_DIR, 'index.html')) ? '已构建，可由同步服务直接打开' : '未构建，请先执行 npm run build'],
    ['习惯 / 待办', `${session.data.habits.length} 个习惯 · ${session.data.tasks.length} 条待办`],
    ['长期规划', `${session.data.nodes.length} 个节点 · ${session.data.edges.length} 条连接（只在网页版编辑）`],
  ]
  const labelWidth = Math.max(...rows.map(([label]) => width(label))) + 2
  const lines = rows.map(([label, value]) => `  ${theme.muted(pad(label, labelWidth))}${value}`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try {
    spawn(command[0], command[1], { stdio: 'ignore', detached: true }).unref()
    return true
  } catch {
    return false
  }
}

async function main() {
  const { options, rest } = parseArgv(process.argv.slice(2))
  const theme = createTheme({ color: options.color })
  const store = createStore(options.data ? path.resolve(options.data) : defaultDataFile())
  const session = createSession(store)
  const bindings = loadBindings(store.file)
  const verb = (rest[0] ?? '').toLowerCase()

  if (verb === 'version') {
    process.stdout.write(`daily-planner ${VERSION}\n`)
    return
  }

  if (verb === 'help') {
    process.stdout.write(`${theme.bold('日常 daily')} ${theme.faint(VERSION)} · 命令行版\n\n`)
    process.stdout.write(`${theme.muted('用法：daily [页面|命令] [参数] · 不带参数进入交互界面')}\n\n`)
    process.stdout.write(`${helpLines(theme, bindings).join('\n')}\n`)
    return
  }

  if (verb === 'serve') {
    const server = await startServer({ store, port: options.port })
    const ready = fs.existsSync(path.join(DIST_DIR, 'index.html'))
    process.stdout.write(`${theme.bold('日常 daily')} ${theme.faint(`同步服务已启动 ${server.url}`)}\n`)
    process.stdout.write(`  ${theme.muted('数据文件')} ${store.file}\n`)
    if (!ready) process.stdout.write(`  ${theme.yellow('还没有构建网页版，请先运行 npm run build')}\n`)
    if (options.open) openBrowser(server.url)
    const stop = () => {
      server.close()
      process.exit(0)
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    return
  }

  if (WEB_COMMANDS.has(verb)) {
    const resolved = await resolveServer({ store, port: options.port })
    const ready = fs.existsSync(path.join(DIST_DIR, 'index.html'))
    if (!ready) {
      process.stdout.write(`${theme.yellow('还没有构建网页版，请先运行 npm run build')}\n`)
      resolved.server?.close()
      process.exitCode = 1
      return
    }
    process.stdout.write(`${theme.bold('日常 daily')} 已在浏览器打开 ${resolved.url}\n`)
    openBrowser(resolved.url)
    if (resolved.server) {
      const stop = () => {
        resolved.server.close()
        process.exit(0)
      }
      process.on('SIGINT', stop)
      process.on('SIGTERM', stop)
      return
    }
    return
  }

  if (verb === 'where' || verb === 'info' || verb === 'status') {
    let serverInfo = null
    for (let index = 0; index < 10; index += 1) {
      const health = await probeServer(options.port + index, store.file)
      if (health) {
        serverInfo = { url: `http://127.0.0.1:${health.port || options.port + index}/` }
        break
      }
    }
    printInfo(theme, session, serverInfo)
    return
  }

  const interactive = !rest.length || TUI_COMMANDS.has(verb)
  if (interactive) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      printPage(session, theme, 'today', bindings)
      return
    }
    let serverInfo = null
    if (options.server) {
      try {
        const resolved = await resolveServer({ store, port: options.port })
        serverInfo = resolved
      } catch (error) {
        session.message = `同步服务未启动：${error.message}`
        session.ok = false
      }
    }
    const built = fs.existsSync(path.join(DIST_DIR, 'index.html'))
    if (serverInfo && !built) {
      session.message = `网页版还没构建：运行 npm run build 后，浏览器打开 ${serverInfo.url} 即可与这里同步。`
      session.ok = true
    } else if (serverInfo && !session.exists) {
      // 数据文件还没建立时，先让浏览器把自己的数据写进来，避免示例数据覆盖它。
      session.message = `还没有数据文件。先打开一次网页版（原来的开发地址或 ${serverInfo.url}），它会导入浏览器里已有的数据。`
      session.ok = true
    }
    if (session.corrupted) {
      session.message = '数据文件无法解析，已载入默认数据；保存时会自动备份原文件。'
      session.ok = false
    }
    await startTui({
      session,
      theme,
      status: () => {
        if (!serverInfo) return '仅本地'
        return `${serverInfo.reused ? '已连接' : '同步'} ${serverInfo.port}`
      },
    })
    serverInfo?.server?.close()
    return
  }

  const line = rest.join(' ')
  const result = runCommand(session, line)
  if (result.help) {
    process.stdout.write(`${helpLines(theme, result.bindings ?? bindings).join('\n')}\n`)
    return
  }
  if (!result.ok) {
    process.stderr.write(`${theme.red(result.message)}\n`)
    process.exitCode = 1
    return
  }
  if (result.page) {
    printPage(session, theme, result.page, result.bindings ?? bindings)
    return
  }
  if (result.message) process.stdout.write(`${theme.green(result.message)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`)
  process.exitCode = 1
})
