import { describe, expect, it } from 'vitest'
import { getCurrentStreak, isHabitScheduled, type Habit } from './data'

describe('habit helpers', () => {
  it('checks repeat days', () => {
    const habit: Habit = { id: '1', title: 'Read', days: [1, 3], color: 'mint', logs: [] }
    expect(isHabitScheduled(habit, 1)).toBe(true)
    expect(isHabitScheduled(habit, 2)).toBe(false)
  })

  it('counts a consecutive streak ending today', () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const habit: Habit = {
      id: '1', title: 'Read', days: [0, 1, 2, 3, 4, 5, 6], color: 'mint',
      logs: [yesterday.toISOString().slice(0, 10), today.toISOString().slice(0, 10)],
    }
    expect(getCurrentStreak(habit, today)).toBe(2)
  })
})
