import type { Edge, Node } from '@xyflow/react'

export type Page = 'today' | 'habits' | 'tasks' | 'roadmap'
export type Habit = {
  id: string
  title: string
  days: number[]
  color: string
  logs: string[]
}
export type Task = {
  id: string
  title: string
  dueDate: string
  priority: 'low' | 'medium' | 'high'
  done: boolean
}
export type Session = {
  id: string
  date: string
  minutes: number
  taskId?: string
  habitId?: string
}
export type Timer = {
  mode: 'focus' | 'break'
  endAt: number | null
  taskId?: string
  habitId?: string
}
export type RoadmapNode = Node<{ label: string; note?: string }>
export type AppData = {
  habits: Habit[]
  tasks: Task[]
  sessions: Session[]
  timer: Timer
  nodes: RoadmapNode[]
  edges: Edge[]
}

export const STORAGE_KEY = 'daily-planner-v1'
export const todayKey = () => new Date().toISOString().slice(0, 10)

export const starterData: AppData = {
  habits: [
    { id: 'h1', title: '晨间阅读', days: [1, 2, 3, 4, 5, 6, 0], color: 'mint', logs: [] },
    { id: 'h2', title: '运动 30 分钟', days: [1, 3, 5, 6], color: 'coral', logs: [] },
    { id: 'h3', title: '写下今日复盘', days: [1, 2, 3, 4, 5, 0], color: 'yellow', logs: [] },
  ],
  tasks: [
    { id: 't1', title: '整理本周的灵感笔记', dueDate: todayKey(), priority: 'high', done: false },
    { id: 't2', title: '给阳台的植物浇水', dueDate: todayKey(), priority: 'low', done: false },
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

export function readAppData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return starterData
    const parsed = JSON.parse(raw) as Partial<AppData>
    return {
      ...starterData,
      ...parsed,
      habits: Array.isArray(parsed.habits) ? parsed.habits : starterData.habits,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : starterData.tasks,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : starterData.nodes,
      edges: Array.isArray(parsed.edges) ? parsed.edges : starterData.edges,
      timer: parsed.timer ?? starterData.timer,
    }
  } catch {
    return starterData
  }
}

export function isHabitScheduled(habit: Habit, day = new Date().getDay()) {
  return habit.days.includes(day)
}

export function getCurrentStreak(habit: Habit, now = new Date()) {
  let streak = 0
  const cursor = new Date(now)
  cursor.setHours(0, 0, 0, 0)
  const logSet = new Set(habit.logs)
  while (logSet.has(cursor.toISOString().slice(0, 10))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}
