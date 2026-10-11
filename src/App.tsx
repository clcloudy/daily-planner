import { useEffect, useMemo, useState } from 'react'
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
} from '@xyflow/react'
import {
  ArrowDownWideNarrow,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Flame,
  Focus,
  GitBranch,
  Leaf,
  ListTodo,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Target,
  Trash2,
  X,
} from 'lucide-react'
import {
  getCurrentStreak,
  isHabitScheduled,
  readAppData,
  STORAGE_KEY,
  todayKey,
  type AppData,
  type Habit,
  type Page,
  type RoadmapNode,
  type Session,
  type Task,
} from './data'

const weekdays = ['日', '一', '二', '三', '四', '五', '六']
const habitColors = ['mint', 'coral', 'yellow', 'lavender']
const navItems: { id: Page; label: string; icon: typeof Sparkles }[] = [
  { id: 'today', label: '今日', icon: Sparkles },
  { id: 'habits', label: '习惯', icon: Leaf },
  { id: 'tasks', label: '待办', icon: ListTodo },
  { id: 'roadmap', label: '长期规划', icon: GitBranch },
]

function dateLabel(date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(date)
}

function greeting() {
  const hour = new Date().getHours()
  return hour < 11 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
}

function App() {
  const [appData, setAppData] = useState<AppData>(readAppData)
  const [page, setPage] = useState<Page>('today')
  const [dialog, setDialog] = useState<'habit' | 'task' | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<RoadmapNode>(appData.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(appData.edges)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData))
  }, [appData])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (JSON.stringify(nodes) !== JSON.stringify(appData.nodes)) {
      setAppData((current) => ({ ...current, nodes: nodes as RoadmapNode[] }))
    }
  }, [nodes])

  useEffect(() => {
    if (JSON.stringify(edges) !== JSON.stringify(appData.edges)) {
      setAppData((current) => ({ ...current, edges }))
    }
  }, [edges])

  const today = todayKey()
  const todayHabits = appData.habits.filter((habit) => isHabitScheduled(habit))
  const completedToday = todayHabits.filter((habit) => habit.logs.includes(today)).length
  const openTasks = appData.tasks.filter((task) => !task.done)
  const completedTasks = appData.tasks.filter((task) => task.done).length
  const focusMinutes = appData.sessions.filter((session) => session.date === today).reduce((sum, session) => sum + session.minutes, 0)
  const timerSeconds = appData.timer.endAt ? Math.max(0, Math.ceil((appData.timer.endAt - now) / 1000)) : (appData.timer.mode === 'focus' ? 25 : 5) * 60

  useEffect(() => {
    if (appData.timer.endAt && now >= appData.timer.endAt) {
      const timer = appData.timer
      if (timer.mode === 'focus') {
        const session: Session = { id: crypto.randomUUID(), date: todayKey(), minutes: 25, taskId: timer.taskId, habitId: timer.habitId }
        setAppData((current) => ({
          ...current,
          sessions: [...current.sessions, session],
          timer: { mode: 'break', endAt: null },
        }))
      } else {
        setAppData((current) => ({ ...current, timer: { mode: 'focus', endAt: null } }))
      }
    }
  }, [now, appData.timer])

  const pageTitle = navItems.find((item) => item.id === page)?.label ?? '今日'
  const selected = nodes.find((node) => node.id === selectedNode)

  function updateHabit(habitId: string) {
    setAppData((current) => ({
      ...current,
      habits: current.habits.map((habit) =>
        habit.id === habitId
          ? { ...habit, logs: habit.logs.includes(today) ? habit.logs.filter((log) => log !== today) : [...habit.logs, today] }
          : habit,
      ),
    }))
  }

  function updateTask(taskId: string, patch: Partial<Task>) {
    setAppData((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task) }))
  }

  function deleteTask(taskId: string) {
    setAppData((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== taskId) }))
  }

  function startTimer() {
    setAppData((current) => ({
      ...current,
      timer: { ...current.timer, endAt: Date.now() + (current.timer.mode === 'focus' ? 25 : 5) * 60 * 1000 },
    }))
  }

  function stopTimer() {
    setAppData((current) => ({ ...current, timer: { ...current.timer, endAt: null } }))
  }

  function addRoadmapNode() {
    const node: RoadmapNode = {
      id: crypto.randomUUID(),
      position: { x: 180 + (nodes.length % 3) * 80, y: 100 + nodes.length * 46 },
      data: { label: '新的想法' },
    }
    setNodes((current) => [...current, node])
    setSelectedNode(node.id)
  }

  function onConnect(connection: Connection) {
    setEdges((current) => addEdge({ ...connection, animated: false }, current))
  }

  const pageContent = useMemo(() => {
    if (page === 'today') {
      return (
        <TodayView
          habits={todayHabits}
          tasks={openTasks}
          doneCount={completedToday}
          focusMinutes={focusMinutes}
          timerSeconds={timerSeconds}
          timer={appData.timer}
          sessions={appData.sessions.filter((session) => session.date === today)}
          onCheckHabit={updateHabit}
          onAddHabit={() => setDialog('habit')}
          onToggleTask={(task) => updateTask(task.id, { done: !task.done })}
          onAddTask={() => setDialog('task')}
          onStartTimer={startTimer}
          onStopTimer={stopTimer}
          onTimerTask={(taskId) => setAppData((current) => ({ ...current, timer: { ...current.timer, taskId } }))}
        />
      )
    }
    if (page === 'habits') {
      return <HabitsView habits={appData.habits} onCheck={updateHabit} onAdd={() => setDialog('habit')} />
    }
    if (page === 'tasks') {
      return <TasksView tasks={appData.tasks} onAdd={() => setDialog('task')} onToggle={(task) => updateTask(task.id, { done: !task.done })} onDelete={deleteTask} onUpdate={updateTask} />
    }
    return (
      <RoadmapView
        nodes={nodes as RoadmapNode[]}
        edges={edges}
        selected={selected}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onAdd={addRoadmapNode}
        onSelect={setSelectedNode}
        onRename={(id, patch) => setNodes((current) => current.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node))}
        onDelete={(id) => {
          setNodes((current) => current.filter((node) => node.id !== id))
          setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id))
          setSelectedNode(null)
        }}
      />
    )
  }, [page, appData, todayHabits, openTasks, completedToday, focusMinutes, timerSeconds, nodes, edges, selected, selectedNode])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage('today')} aria-label="回到今日">
          <span className="brand-mark"><span /></span>
          <span className="brand-name">日常<span>daily</span></span>
        </button>
        <div className="workspace-label">你的空间</div>
        <nav className="main-nav" aria-label="主导航">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button className={`nav-item ${page === id ? 'active' : ''}`} key={id} onClick={() => setPage(id)}>
              <Icon size={18} strokeWidth={1.9} />
              <span>{label}</span>
              {id === 'tasks' && openTasks.length > 0 && <span className="nav-count">{openTasks.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-quote"><span className="quote-mark">“</span><p>慢慢来，<br />比较快。</p><small>今日提醒</small></div>
          <div className="profile"><div className="avatar">L</div><div><strong>Lin 的空间</strong><small>个人计划</small></div><MoreHorizontal size={18} /></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>我的空间</span><ChevronRight size={14} /><strong>{pageTitle}</strong></div>
          <div className="topbar-actions"><span className="date-chip"><span className="date-dot" />{dateLabel()}</span><button className="icon-button" title="帮助" aria-label="帮助"><CircleHelp size={19} /></button></div>
        </header>
        <div className="page-wrap">
          {page !== 'roadmap' && (
            <div className="page-heading">
              <div><p className="eyebrow">{page === 'today' ? dateLabel() : 'PERSONAL SPACE'}</p><h1>{page === 'today' ? `${greeting()}，Lin` : pageTitle}</h1>
                <p className="heading-subtitle">{page === 'today' ? '给今天一点清晰，也留一点余地。' : page === 'habits' ? '小小的重复，会慢慢变成很远的路。' : '把想做的事，变成下一步。'}</p>
              </div>
              {page === 'today' && <div className="heading-flower"><span>✳</span><small>保持自己的<br />节奏就好</small></div>}
            </div>
          )}
          {pageContent}
          <footer className="page-footer"><span>今天也在慢慢向前</span><span className="footer-line" /><span>{completedTasks} 件事已完成</span></footer>
        </div>
      </main>
      {dialog && <EntryDialog kind={dialog} onClose={() => setDialog(null)} onSave={(value) => {
        if (dialog === 'habit') {
          setAppData((current) => ({ ...current, habits: [...current.habits, { id: crypto.randomUUID(), title: value.title, days: value.days ?? [0, 1, 2, 3, 4, 5, 6], color: habitColors[current.habits.length % habitColors.length], logs: [] }] }))
        } else {
          setAppData((current) => ({ ...current, tasks: [...current.tasks, { id: crypto.randomUUID(), title: value.title, dueDate: value.dueDate ?? '', priority: value.priority ?? 'medium', done: false }] }))
        }
        setDialog(null)
      }} />}
    </div>
  )
}

function TodayView(props: {
  habits: Habit[]
  tasks: Task[]
  doneCount: number
  focusMinutes: number
  timerSeconds: number
  timer: AppData['timer']
  sessions: Session[]
  onCheckHabit: (id: string) => void
  onAddHabit: () => void
  onToggleTask: (task: Task) => void
  onAddTask: () => void
  onStartTimer: () => void
  onStopTimer: () => void
  onTimerTask: (taskId: string) => void
}) {
  const progress = props.habits.length ? Math.round((props.doneCount / props.habits.length) * 100) : 0
  const minutes = String(Math.floor(props.timerSeconds / 60)).padStart(2, '0')
  const seconds = String(props.timerSeconds % 60).padStart(2, '0')
  return (
    <>
      <section className="stats-row">
        <Stat icon={Target} label="今日习惯" value={`${props.doneCount} / ${props.habits.length}`} note={`${progress}% 完成`} tone="green" />
        <Stat icon={ListTodo} label="待办事项" value={`${props.tasks.length}`} note="件待完成" tone="orange" />
        <Stat icon={Focus} label="专注时长" value={props.focusMinutes >= 60 ? `${Math.floor(props.focusMinutes / 60)}h ${props.focusMinutes % 60}m` : `${props.focusMinutes}m`} note="今天累计" tone="blue" />
        <Stat icon={Flame} label="当前节奏" value={`${Math.max(0, ...props.habits.map((habit) => getCurrentStreak(habit)))} 天`} note="最长连续打卡" tone="pink" />
      </section>
      <div className="dashboard-grid">
        <section className="panel habit-panel">
          <div className="section-head"><div><p className="section-kicker">DAILY RITUALS</p><h2>今日习惯 <span className="count-pill">{props.doneCount}/{props.habits.length}</span></h2></div><button className="text-button" onClick={props.onAddHabit}><Plus size={16} />添加习惯</button></div>
          <div className="habit-list">
            {props.habits.length === 0 ? <EmptyState title="今天没有安排习惯" action="添加一个习惯" onClick={props.onAddHabit} /> : props.habits.map((habit) => {
              const checked = habit.logs.includes(todayKey())
              return <button key={habit.id} className={`habit-row ${checked ? 'is-done' : ''}`} onClick={() => props.onCheckHabit(habit.id)}>
                <span className={`habit-check ${habit.color}`}>{checked && <Check size={15} />}</span>
                <span className="habit-name">{habit.title}</span><span className="habit-streak"><Flame size={14} />{getCurrentStreak(habit)}</span><span className="row-chevron"><ChevronRight size={16} /></span>
              </button>
            })}
          </div>
          <div className="habit-foot"><span className="mini-calendar">{weekdays.map((day, index) => <span key={day + index} className={index === new Date().getDay() ? 'today' : ''}>{day}</span>)}</span><button className="subtle-button" onClick={() => window.dispatchEvent(new CustomEvent('show-all-habits'))}>本周习惯 <ArrowUpRight size={13} /></button></div>
        </section>
        <section className="panel focus-panel">
          <div className="section-head"><div><p className="section-kicker">POMODORO</p><h2>专注一下</h2></div><button className="icon-button small" title="重置计时器" aria-label="重置计时器" onClick={props.onStopTimer}><RotateCcw size={16} /></button></div>
          <div className="timer-face">
            <svg viewBox="0 0 200 200" aria-hidden="true"><circle className="timer-track" cx="100" cy="100" r="88" /><circle className="timer-progress" cx="100" cy="100" r="88" /></svg>
            <div className="timer-content"><span>{props.timer.mode === 'focus' ? '专注时间' : '休息时间'}</span><strong>{minutes}:{seconds}</strong><small>{props.timer.mode === 'focus' ? '做一件事就好' : '伸展一下，喝口水'}</small></div>
          </div>
          <label className="timer-link"><span>专注于</span><select value={props.timer.taskId ?? ''} onChange={(event) => props.onTimerTask(event.target.value)} aria-label="选择专注事项"><option value="">自由专注</option>{props.tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select><ChevronDown size={14} /></label>
          <button className={`timer-button ${props.timer.endAt ? 'running' : ''}`} onClick={props.timer.endAt ? props.onStopTimer : props.onStartTimer}>{props.timer.endAt ? <><Pause size={16} />暂停计时</> : <><Play size={16} fill="currentColor" />开始专注</>}</button>
          <p className="focus-note">{props.sessions.length > 0 ? `今天已经完成 ${props.sessions.length} 个专注时段` : '一个番茄钟，给自己一点专注时间'}</p>
        </section>
        <section className="panel task-panel">
          <div className="section-head"><div><p className="section-kicker">NEXT UP</p><h2>待办清单 <span className="count-pill">{props.tasks.length}</span></h2></div><button className="text-button" onClick={props.onAddTask}><Plus size={16} />添加待办</button></div>
          <div className="task-list">
            {props.tasks.length === 0 ? <EmptyState title="暂时没有待办" action="添加一件事" onClick={props.onAddTask} /> : props.tasks.slice(0, 4).map((task) => <TaskRow key={task.id} task={task} onToggle={() => props.onToggleTask(task)} />)}
          </div>
          {props.tasks.length > 4 && <div className="panel-link">还有 {props.tasks.length - 4} 件待办</div>}
        </section>
        <section className="quote-panel"><div className="quote-decoration">“</div><div><p>专注于过程，<br />结果会自己出现。</p><span>— 生活小札</span></div><div className="quote-sun">☼</div></section>
      </div>
    </>
  )
}

function Stat({ icon: Icon, label, value, note, tone }: { icon: typeof Sparkles; label: string; value: string; note: string; tone: string }) {
  return <div className={`stat ${tone}`}><div className="stat-top"><span className="stat-icon"><Icon size={17} /></span><span>{label}</span><MoreHorizontal size={16} className="stat-more" /></div><div className="stat-value">{value}<small>{note}</small></div></div>
}

function EmptyState({ title, action, onClick }: { title: string; action: string; onClick: () => void }) {
  return <div className="empty-state"><span>{title}</span><button onClick={onClick}>{action} <ArrowUpRight size={13} /></button></div>
}

function TaskRow({ task, onToggle, onDelete }: { task: Task; onToggle: () => void; onDelete?: () => void }) {
  const due = task.dueDate === todayKey() ? '今天' : task.dueDate ? new Date(`${task.dueDate}T00:00:00`).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : ''
  return <div className={`task-row ${task.done ? 'is-done' : ''}`}>
    <button className="task-check" onClick={onToggle} aria-label={task.done ? `标记${task.title}未完成` : `完成${task.title}`}>{task.done && <Check size={13} />}</button>
    <span className="task-title">{task.title}</span>{due && <span className="task-due">{due}</span>}<span className={`priority-dot ${task.priority}`} title={`${task.priority} 优先级`} />{onDelete && <button className="icon-button delete-button" onClick={onDelete} title="删除待办" aria-label="删除待办"><Trash2 size={15} /></button>}
  </div>
}

function HabitsView({ habits, onCheck, onAdd }: { habits: Habit[]; onCheck: (id: string) => void; onAdd: () => void }) {
  const today = todayKey()
  const scheduled = habits.filter((habit) => isHabitScheduled(habit))
  const doneCount = scheduled.filter((habit) => habit.logs.includes(today)).length
  const weekDates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + index)
    return date.toISOString().slice(0, 10)
  })
  return <section className="panel full-panel">
    <div className="section-head"><div><p className="section-kicker">BUILD YOUR RHYTHM</p><h2>习惯追踪</h2><p className="panel-description">每一次打卡，都是给自己的一个小小承诺。</p></div><button className="primary-button" onClick={onAdd}><Plus size={16} />新建习惯</button></div>
    <div className="habit-summary"><div><strong>{doneCount}<small> / {scheduled.length}</small></strong><span>今日完成</span></div><div className="summary-progress"><span style={{ width: `${scheduled.length ? doneCount / scheduled.length * 100 : 0}%` }} /></div><span className="summary-percent">{scheduled.length ? Math.round(doneCount / scheduled.length * 100) : 0}%</span></div>
    <div className="habit-table">
      <div className="habit-table-head"><span>习惯</span><span>连续</span><span>本周</span><span>今日</span></div>
      {habits.map((habit) => <div className="habit-table-row" key={habit.id}><div className="habit-table-title"><span className={`habit-check ${habit.color}`}>{habit.logs.includes(today) && <Check size={13} />}</span><div><strong>{habit.title}</strong><small>{habit.days.length === 7 ? '每天' : `每周 ${habit.days.map((d) => weekdays[d]).join('、')}`}</small></div></div><div className="streak-cell"><Flame size={14} />{getCurrentStreak(habit)} 天</div><div className="week-dots">{weekDates.map((date, index) => <span className={`${habit.logs.includes(date) ? 'checked' : ''} ${date === today ? 'today' : ''}`} key={date} title={`${weekdays[(index + 1) % 7]} ${habit.logs.includes(date) ? '已完成' : '未完成'}`}>{habit.logs.includes(date) && <Check size={11} />}</span>)}</div><button className={`checkin-button ${habit.logs.includes(today) ? 'checked' : ''}`} onClick={() => onCheck(habit.id)}>{habit.logs.includes(today) ? <><Check size={14} />已打卡</> : '打卡'}</button></div>)}
      {habits.length === 0 && <EmptyState title="还没有添加习惯" action="新建习惯" onClick={onAdd} />}
    </div>
  </section>
}

function TasksView({ tasks, onAdd, onToggle, onDelete, onUpdate }: { tasks: Task[]; onAdd: () => void; onToggle: (task: Task) => void; onDelete: (id: string) => void; onUpdate: (id: string, patch: Partial<Task>) => void }) {
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('open')
  const shown = tasks.filter((task) => filter === 'all' || (filter === 'open' ? !task.done : task.done))
  const overdue = tasks.filter((task) => !task.done && task.dueDate && task.dueDate < todayKey()).length
  return <section className="panel full-panel">
    <div className="section-head"><div><p className="section-kicker">CLEAR YOUR MIND</p><h2>待办事项</h2><p className="panel-description">先记下来，再一件一件完成。</p></div><button className="primary-button" onClick={onAdd}><Plus size={16} />添加待办</button></div>
    <div className="task-toolbar"><div className="segmented">{(['open', 'all', 'done'] as const).map((item) => <button className={filter === item ? 'selected' : ''} key={item} onClick={() => setFilter(item)}>{item === 'open' ? '未完成' : item === 'all' ? '全部' : '已完成'}</button>)}</div><span className="task-tally">{overdue > 0 ? `${overdue} 件已逾期` : `${tasks.filter((task) => !task.done).length} 件待处理`}</span></div>
    <div className="task-board">
      {shown.map((task) => <div className={`task-board-row ${task.done ? 'is-done' : ''}`} key={task.id}><TaskRow task={task} onToggle={() => onToggle(task)} onDelete={() => onDelete(task.id)} /><label className="priority-select"><ArrowDownWideNarrow size={13} /><select aria-label={`${task.title}优先级`} value={task.priority} onChange={(event) => onUpdate(task.id, { priority: event.target.value as Task['priority'] })}><option value="high">高优先级</option><option value="medium">普通</option><option value="low">低优先级</option></select><ChevronDown size={12} /></label><label className="due-select"><Clock3 size={13} /><input type="date" aria-label={`${task.title}截止日期`} value={task.dueDate} onChange={(event) => onUpdate(task.id, { dueDate: event.target.value })} /></label></div>)}
      {shown.length === 0 && <div className="empty-board"><CheckCheck size={25} /><strong>{filter === 'done' ? '还没有完成的事项' : '清爽的一天，从这里开始'}</strong><span>{filter === 'done' ? '完成一件待办后，它会出现在这里。' : '当前没有待办事项，可以享受片刻轻松。'}</span></div>}
    </div>
  </section>
}

function RoadmapView({ nodes, edges, selected, onNodesChange, onEdgesChange, onConnect, onAdd, onSelect, onRename, onDelete }: {
  nodes: RoadmapNode[]
  edges: AppData['edges']
  selected?: RoadmapNode
  onNodesChange: (changes: never[]) => void
  onEdgesChange: (changes: never[]) => void
  onConnect: (connection: Connection) => void
  onAdd: () => void
  onSelect: (id: string | null) => void
  onRename: (id: string, patch: Partial<RoadmapNode['data']>) => void
  onDelete: (id: string) => void
}) {
  return <section className="roadmap-layout">
    <div className="roadmap-header"><div><p className="section-kicker">THINK IN POSSIBILITIES</p><h1>长期规划</h1><p>把脑海里的想法，慢慢连成一条自己的路。</p></div><button className="primary-button" onClick={onAdd}><Plus size={16} />添加节点</button></div>
    <div className="roadmap-tools"><span className="roadmap-hint"><span className="hint-dot" />拖动节点自由布局，拖拽连接点建立关联</span><span>{nodes.length} 个节点 · {edges.length} 条连接</span></div>
    <div className={`canvas-shell ${selected ? 'with-inspector' : ''}`}>
      <div className="roadmap-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange as never}
          onEdgesChange={onEdgesChange as never}
          onConnect={onConnect}
          onNodeClick={(_, node) => onSelect(node.id)}
          onPaneClick={() => onSelect(null)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.25}
          maxZoom={1.8}
          defaultEdgeOptions={{ type: 'smoothstep' }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#d8ded7" gap={22} size={1} />
          <Controls position="bottom-right" />
          <MiniMap position="bottom-left" nodeColor="#b9d7bf" maskColor="rgba(246, 248, 244, 0.68)" />
        </ReactFlow>
      </div>
      {selected && <aside className="node-inspector"><div className="inspector-head"><span>节点详情</span><button className="icon-button small" onClick={() => onSelect(null)} aria-label="关闭节点详情"><X size={15} /></button></div><label>名称<input autoFocus value={selected.data.label} onChange={(event) => onRename(selected.id, { label: event.target.value })} /></label><label>备注<textarea value={selected.data.note ?? ''} onChange={(event) => onRename(selected.id, { note: event.target.value })} placeholder="补充一点想法..." rows={4} /></label><p className="inspector-help">选中节点后，可拖动节点左右两侧的圆点创建连接。</p><button className="danger-button" onClick={() => onDelete(selected.id)}><Trash2 size={14} />删除节点</button></aside>}
    </div>
  </section>
}

function EntryDialog({ kind, onClose, onSave }: { kind: 'habit' | 'task'; onClose: () => void; onSave: (value: { title: string; days?: number[]; dueDate?: string; priority?: Task['priority'] }) => void }) {
  const [title, setTitle] = useState('')
  const [days, setDays] = useState([1, 2, 3, 4, 5, 6, 0])
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<Task['priority']>('medium')
  const isHabit = kind === 'habit'
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <form className="entry-dialog" onSubmit={(event) => { event.preventDefault(); if (title.trim()) onSave({ title: title.trim(), days, dueDate, priority }) }}>
      <div className="dialog-head"><div><span className={`dialog-icon ${isHabit ? 'mint' : 'orange'}`}>{isHabit ? <Leaf size={18} /> : <ListTodo size={18} />}</span><div><h2>{isHabit ? '添加习惯' : '添加待办'}</h2><p>{isHabit ? '让想坚持的事，有一个轻松的开始。' : '把脑海里的事情，先放在这里。'}</p></div></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></div>
      <label className="field-label">{isHabit ? '习惯名称' : '待办内容'}<input autoFocus required maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={isHabit ? '例如：每天读 10 页书' : '例如：整理本周的灵感笔记'} /></label>
      {isHabit ? <fieldset className="days-field"><legend>重复日期</legend><div className="day-picker">{weekdays.map((day, index) => <button type="button" key={day + index} className={days.includes(index) ? 'selected' : ''} onClick={() => setDays((current) => current.includes(index) ? current.filter((value) => value !== index) : [...current, index])}>{day}</button>)}</div></fieldset> : <div className="dialog-fields"><label className="field-label">截止日期<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label><label className="field-label">优先级<select value={priority} onChange={(event) => setPriority(event.target.value as Task['priority'])}><option value="high">高</option><option value="medium">普通</option><option value="low">低</option></select></label></div>}
      <div className="dialog-actions"><button type="button" className="subtle-button" onClick={onClose}>取消</button><button type="submit" className="primary-button"><Plus size={15} />{isHabit ? '创建习惯' : '添加待办'}</button></div>
    </form>
  </div>
}

export default App
