# 日常 daily

一个支撑个人长期学习的软件：用导图规划学习目标，用习惯和待办把目标拆成每天能做完的一小步。

- **网页版**：习惯打卡、待办清单、番茄钟、长期规划导图。
- **命令行版**：同样内容的极简终端界面，零依赖、低占用，适合长期挂在后台；内置可开关的专注热力图插件，把每天的专注时长铺成一张年度格子图。

两种界面共用同一份数据文件，改动会实时互推。

## 快速开始

### 网页版

```bash
npm install
npm run dev -- --host 127.0.0.1
```

Windows 上也可以双击 `启动日常.bat`。

### 命令行版

```bash
node cli/daily.mjs
```

Windows 上双击 `启动日常命令行.bat`。不需要 `npm install`，只需要 Node.js。

### 两端同步（推荐）

1. 先构建一次网页版：`npm run build`
2. 运行 `node cli/daily.mjs`，它会同时启动本地同步服务。
3. 浏览器打开 `http://127.0.0.1:8787/`，终端与浏览器就是同一份数据。

已有的数据不用手动搬家：继续用 `npm run dev` 的老地址打开网页版也可以，页面会自动连上命令行服务，把浏览器里的数据写进数据文件。

命令行界面用 `ctrl-p` 输入命令，`ctrl-g` 查看帮助，`ctrl-n` 打开专注热力图（用 `plugin heatmap off` 可关闭这个插件）；快捷键都是组合键，可以用 `key` 命令改键位。完整命令表见 [`docs/CLI.md`](docs/CLI.md)。

## 数据

- 数据文件：`~/.daily-planner/data.json`（可用 `--data` 或 `DAILY_PLANNER_DATA` 指定）。
- 浏览器仍然保留 localStorage 作为离线兜底；没有同步服务时网页版行为与以前完全一致。
- 命令行提供 `export` / `import` 做 JSON 备份与恢复。

## 开发

```bash
npm test          # 数据层、命令行、同步服务、TUI 交互测试
npm run build     # 类型检查 + 网页版构建
node cli/daily.mjs help
```

维护流程见 [`docs/MAINTENANCE.md`](docs/MAINTENANCE.md)，代理开发规范见 [`AGENTS.md`](AGENTS.md)。
