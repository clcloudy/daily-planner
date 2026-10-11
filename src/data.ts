import type { Edge, Node } from '@xyflow/react'
import {
  STORAGE_KEY,
  SYNC_META_KEY,
  dayKey,
  getCurrentStreak,
  isHabitScheduled,
  normalizeAppData as coreNormalizeAppData,
  starterData as coreStarterData,
  todayKey,
  type AppData as CoreAppData,
} from './core.mjs'

export type Page = 'today' | 'habits' | 'tasks' | 'roadmap'
export type { Habit, Priority, Session, Task, Timer } from './core.mjs'
export type RoadmapNode = Node<{ label: string; note?: string }>
export type AppData = Omit<CoreAppData, 'nodes' | 'edges'> & {
  nodes: RoadmapNode[]
  edges: Edge[]
}

export { STORAGE_KEY, SYNC_META_KEY, dayKey, isHabitScheduled, getCurrentStreak, todayKey }

/**
 * 数据模型与计算逻辑都在 src/core.mjs 里，网页版和命令行版共用同一份实现。
 * 这里只补充 React Flow 的节点/连线类型和浏览器存储相关逻辑。
 */
export const starterData = coreStarterData as AppData

export function normalizeAppData(value: unknown): AppData {
  return coreNormalizeAppData(value) as AppData
}

export function readAppData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return starterData
    return normalizeAppData(JSON.parse(raw))
  } catch {
    return starterData
  }
}
