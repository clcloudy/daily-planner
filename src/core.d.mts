/** src/core.mjs 的类型声明，供 TypeScript 侧的 src/data.ts 使用。 */

export type Priority = 'low' | 'medium' | 'high'

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
  priority: Priority
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

export type RoadmapNode = {
  id: string
  position: { x: number; y: number }
  data: { label: string; note?: string }
  type?: string
}

export type AppEdge = {
  id: string
  source: string
  target: string
  animated?: boolean
}

export type AppData = {
  habits: Habit[]
  tasks: Task[]
  sessions: Session[]
  timer: Timer
  nodes: RoadmapNode[]
  edges: AppEdge[]
}

export type Summary = {
  today: string
  scheduledHabits: Habit[]
  doneHabits: Habit[]
  habitProgress: number
  openTasks: Task[]
  overdueTasks: Task[]
  doneTaskCount: number
  focusMinutes: number
  bestStreak: number
  todaySessions: Session[]
}

export declare const STORAGE_KEY: string
export declare const SYNC_META_KEY: string
export declare const DATA_FILE_VERSION: number
export declare const HABIT_COLORS: string[]
export declare const WEEKDAYS: string[]
export declare const FOCUS_MINUTES: number
export declare const BREAK_MINUTES: number

export declare function createId(): string
export declare function dayKey(date: Date): string
export declare function todayKey(): string
export declare function parseDayInput(input: string, now?: Date): string | null
export declare function isHabitScheduled(habit: Habit, day?: number): boolean
export declare function getCurrentStreak(habit: Habit, now?: Date): number
export declare function weekDates(now?: Date): string[]
export declare function createStarterData(): AppData
export declare const starterData: AppData
export declare function normalizeAppData(value: unknown): AppData
export declare function createHabit(input: { title: string; days?: number[]; color?: string; index?: number }): Habit
export declare function createTask(input: { title: string; dueDate?: string; priority?: Priority }): Task
export declare function createSession(input: { minutes?: number; taskId?: string; habitId?: string; date?: string }): Session
export declare function summarize(data: AppData, now?: Date): Summary
export declare function formatFocus(minutes: number): string
export declare function dateLabel(date?: Date): string
export declare function greeting(now?: Date): string
export declare function formatDue(dueDate: string, today?: string): string
export declare function formatDays(days: number[]): string
