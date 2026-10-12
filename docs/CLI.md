# 命令行版（daily CLI）

命令行版和网页版**共用同一份数据文件**，可以同时打开：一边在浏览器里拖导图，一边在终端里打卡，改动会立刻互相推送。

- 零第三方依赖，只用 Node 内置模块；常驻内存大约 30–60 MB。
- 事件驱动，没有动画循环；只有番茄钟运行期间才启用 1 秒定时器。
- 界面是纯文本 + ANSI 配色，简约、无边框，中英文混排按显示宽度对齐。

## 启动

```bash
node cli/daily.mjs            # 进入交互界面（同时启动本地同步服务）
```

Windows 上双击 `启动日常命令行.bat` 也可以。不需要 `npm install`，也不需要 Vite。

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--no-server` | 只开命令行，不启动本地同步服务（最省资源） |
| `--port 8787` | 指定同步服务端口，默认 8787（可用 `DAILY_PLANNER_PORT` 覆盖） |
| `--data <路径>` | 使用指定的数据文件，默认 `~/.daily-planner/data.json` |
| `--no-color` | 关闭颜色输出（`NO_COLOR` 环境变量等效） |

## 交互快捷键

快捷指令默认全部是 **ctrl 组合键**（避免误触，也给以后的文字输入留出单键）；光标移动保留 `j` `k` 与方向键。

| 按键 | 作用 |
| --- | --- |
| `1` `2` `3` / `Tab` | 切换 今日 / 习惯 / 待办 |
| `j` `k` / `↑` `↓` | 移动光标 |
| `g` / `G` | 跳到第一项 / 最后一项 |
| `ctrl-t` | 打卡或完成光标所在项 |
| `ctrl-a` | 添加（习惯页加习惯，其他页加待办） |
| `ctrl-e` | 编辑光标所在项 |
| `ctrl-x` | 删除光标所在项（`y` 确认） |
| `ctrl-f` | 开始 / 暂停番茄钟 |
| `ctrl-r` | 重新读取数据文件 |
| `ctrl-o` | 切换待办筛选（未完成 / 全部 / 已完成） |
| `ctrl-p` | 输入命令，`Tab` 补全，`↑` `↓` 翻历史 |
| `ctrl-g` | 帮助 |
| `ctrl-q` | 退出 |

`ctrl-c` / `ctrl-d` 在任何界面下都能直接退出，`ctrl-l` 重绘；这三个是保留键。专注结束后的弹窗用 `ctrl-b` 休息、`ctrl-e` 结束本轮，确认框用 `y` / `n`，这些是弹窗固定键。

## 键位设置

所有快捷键都可以用 `key` 命令修改，配置写在数据文件同目录的 `keys.json`（只存与默认值的差异，网页版同步数据不会影响它）：

```bash
node cli/daily.mjs key                # 查看全部动作与当前键位（等同帮助）
node cli/daily.mjs key quit           # 查看单个动作的键位
node cli/daily.mjs key quit ctrl-w    # 把「退出」改绑到 ctrl-w（覆盖原键位）
node cli/daily.mjs key quit -         # 恢复该动作的默认键位
node cli/daily.mjs key reset          # 全部恢复默认
```

- 可用动作：`quit` `help` `command` `toggle` `add` `edit` `delete` `focus` `reload` `filter` `up` `down` `top` `bottom` `next-page` `prev-page` `page1` `page2` `page3`。
- 按键写法：`ctrl-a` ~ `ctrl-z`（也接受 `ctrl+q`）、单个字符（区分大小写，如 `g` 与 `G`）、命名键 `up` / `down` / `left` / `right` / `home` / `end` / `tab` / `enter` / `space` / `esc` / `backspace` / `delete`。
- 已被占用的键会提示先解除；`key <动作> -` 或 `key reset` 可随时恢复默认。
- 在交互界面里改完键位立即生效，重启后依然有效。

## 命令

在 `:` 后面输入，也可以直接作为一次性命令执行（例如 `node cli/daily.mjs tasks`）。

```text
today / t                  今日概览
habits / h                 习惯打卡与周视图
tasks / k                  待办清单
filter open|all|done       切换待办筛选

check <习惯>               切换今天的打卡状态
add habit <名称> [--days 1,2,3]
rename habit <习惯> <新名称>
del habit <习惯>

add task <内容> [--due 明天] [--priority 高]
done <待办> / undone <待办>
pri <待办> <高|中|低>
due <待办> <日期|->         - 表示清空日期
del task <待办>

focus start [待办]         开始 25 分钟番茄钟
focus stop                 暂停并重置

sync                       重新读取数据文件
export [路径]              导出 JSON 备份
import <路径>              从 JSON 备份恢复
where                      显示数据文件位置
key [动作] [组合键]        查看 / 修改快捷键位，key reset 恢复默认
```

- `<习惯>`、`<待办>` 可以写名称、ID 前缀、唯一标题片段，也可以写 `#1`（当前列表第 1 项）。
- `--days` 支持 `0-6`、`一/二/三…`、`每天`、`工作日`、`周末`。
- `--due` 支持 `今天`、`明天`、`2025-06-05`。

## 与网页版同步

1. 命令行运行时会在 `127.0.0.1:8787` 起一个只监听本机的服务，`GET /api/data` 读、`PUT /api/data` 写、`GET /api/events` 用 SSE 推送变化。
2. 浏览器打开 `http://127.0.0.1:8787/`（由该服务直接托管 `dist/`），页面会自动连上同一份数据文件，顶部显示「已同步」。
3. **网页版仍然用 `npm run dev` 打开也可以同步**：浏览器的存储是按来源隔离的，`127.0.0.1:5173` 和 `127.0.0.1:8787` 互不相通，所以页面会先试同来源，再自动去找默认的 `http://127.0.0.1:8787`。命令行在跑的时候，旧地址打开的页面一样会同步。
4. 如果数据文件还不存在，第一个连上的网页会把浏览器里已有的 localStorage 数据写进文件，不会丢数据。
5. 命令行先写、网页后开：以文件为准，网页只做镜像；替换前会把浏览器原有数据另存为 `daily-planner-v1-backup-<时间戳>`，可以随时找回。
6. 网页在服务不可用时照常工作（写 localStorage 并标记为待上传），服务恢复后自动重试上传。

如果同步服务不在默认端口（8787 被占用时会自动往后找），可以在浏览器控制台指定一次：

```js
localStorage.setItem('daily-planner-server', 'http://127.0.0.1:8788')
```

跨来源访问只对本地来源（`127.0.0.1` / `localhost` / `::1`）开放，其它网站既读不到也写不进你的数据。

数据文件格式：

```json
{ "version": 1, "revision": 12, "updatedAt": 1730000000000, "source": "web", "data": { "habits": [], "tasks": [], "sessions": [], "timer": {}, "nodes": [], "edges": [] } }
```

`revision` 每次写入递增，两端靠它区分「别人的修改」和「自己刚写的内容」，避免互相回写。

> 已知取舍：写入采用整份快照、后写覆盖，不做字段级合并。单人使用时不会冲突；同时用两端编辑同一条数据时，最后保存的一方生效。

## 长期规划导图

导图只在网页版编辑。命令行会**原样保留** `nodes` / `edges` 数据（不做任何裁剪），也可以查看数量：

```bash
node cli/daily.mjs node count
```

## 资源占用

- 命令行版不依赖任何 npm 包，也没有后台轮询：空闲时进程完全阻塞在标准输入上。
- 同步服务只在有文件变化或浏览器连接时才工作，SSE 心跳 25 秒一次。
- 只想让浏览器和终端共享数据时，可以单独跑 `node cli/daily.mjs serve`，不开交互界面。
