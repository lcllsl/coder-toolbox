import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useHealthStore } from '@/app/stores/health'
import {
  calculateNextTriggerAt,
  createDefaultReminders,
  createReminderConfig,
  getDueReminderIds,
  isHealthSuppressed,
  isInQuietHours,
} from '@/features/health/core/scheduler'
import { createDefaultHealthSettings } from '@/features/health/repositories/health-settings-repository'

describe('health reminder scheduler', () => {
  it('creates the five documented defaults', () => {
    const reminders = createDefaultReminders(new Date('2026-07-21T08:00:00Z'))
    expect(reminders.map(({ id, enabled, intervalMinutes }) => ({ id, enabled, intervalMinutes }))).toEqual([
      { id: 'stand', enabled: true, intervalMinutes: 50 },
      { id: 'water', enabled: true, intervalMinutes: 45 },
      { id: 'pelvic_floor', enabled: false, intervalMinutes: 60 },
      { id: 'eye_rest', enabled: true, intervalMinutes: 30 },
      { id: 'posture', enabled: false, intervalMinutes: 40 },
    ])
  })

  it('calculates interval and snooze trigger times', () => {
    const now = new Date('2026-07-21T08:00:00Z')
    expect(calculateNextTriggerAt({ intervalMinutes: 50, snoozeMinutes: 10 }, 'interval', now)).toBe('2026-07-21T08:50:00.000Z')
    expect(calculateNextTriggerAt({ intervalMinutes: 50, snoozeMinutes: 10 }, 'snooze', now)).toBe('2026-07-21T08:10:00.000Z')
  })

  it('creates validated custom reminders and schedules them after default priorities', () => {
    const now = new Date('2026-07-21T08:00:00Z')
    const custom = createReminderConfig('custom-stretch', {
      title: '  伸展肩颈  ', message: '  放松肩膀和颈部。  ', intervalMinutes: 25, enabled: true,
    }, now)
    expect(custom).toMatchObject({ id: 'custom-stretch', title: '伸展肩颈', message: '放松肩膀和颈部。', intervalMinutes: 25, snoozeMinutes: 10, enabled: true })
    const reminders = [custom, ...createDefaultReminders(now).map((item) => ({ ...item, enabled: item.id === 'stand', nextTriggerAt: now.toISOString() }))]
    custom.nextTriggerAt = now.toISOString()
    expect(getDueReminderIds(reminders, now)).toEqual(['stand', 'custom-stretch'])
    expect(() => createReminderConfig('invalid', { title: '', message: '介绍', intervalMinutes: 4, enabled: true }, now)).toThrow()
  })

  it('handles quiet hours that cross midnight', () => {
    const quiet = { enabled: true, start: '22:00', end: '08:00' }
    expect(isInQuietHours(new Date(2026, 6, 21, 23, 0), quiet)).toBe(true)
    expect(isInQuietHours(new Date(2026, 6, 22, 7, 59), quiet)).toBe(true)
    expect(isInQuietHours(new Date(2026, 6, 22, 8, 0), quiet)).toBe(false)
  })

  it('returns simultaneous reminders in product priority order', () => {
    const now = new Date('2026-07-21T08:00:00Z')
    const reminders = createDefaultReminders(now).map((item) => ({ ...item, enabled: true, nextTriggerAt: now.toISOString() }))
    expect(getDueReminderIds(reminders, now)).toEqual(['stand', 'eye_rest', 'water', 'posture', 'pelvic_floor'])
  })

  it('suppresses display during silent, pause, mute-today, or quiet modes', () => {
    const now = new Date(2026, 6, 21, 23, 0)
    const settings = createDefaultHealthSettings(now)
    expect(isHealthSuppressed(settings, now)).toBe(true)
    settings.quietHours.enabled = false
    settings.silentMode = true
    expect(isHealthSuppressed(settings, now)).toBe(true)
    settings.silentMode = false
    settings.pausedUntil = new Date(now.getTime() + 1_000).toISOString()
    expect(isHealthSuppressed(settings, now)).toBe(true)
  })
})

describe('health reminder actions', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('records completion and resets the interval', async () => {
    const store = useHealthStore()
    const now = new Date('2026-07-21T10:00:00Z')
    store.settings.quietHours.enabled = false
    store.settings.reminders = store.settings.reminders.map((item) => ({ ...item, enabled: item.id === 'stand', nextTriggerAt: now.toISOString() }))
    store.initialized = true

    await store.tick(now)
    expect(store.activeReminder?.id).toBe('stand')
    await store.completeActive(now)

    expect(store.completedToday.stand).toBe(1)
    expect(store.pendingCount).toBe(0)
    expect(store.settings.reminders.find((item) => item.id === 'stand')?.nextTriggerAt).toBe('2026-07-21T10:50:00.000Z')
  })

  it('snoozes without increasing completion count', async () => {
    const store = useHealthStore()
    const now = new Date('2026-07-21T10:00:00Z')
    store.pendingIds = ['eye_rest']
    store.cardVisible = true
    await store.snoozeActive(now)

    expect(store.completedToday.eye_rest).toBeUndefined()
    expect(store.settings.reminders.find((item) => item.id === 'eye_rest')?.nextTriggerAt).toBe('2026-07-21T10:05:00.000Z')
  })

  it('keeps only the highest-priority reminder after a sleep-like gap', async () => {
    const store = useHealthStore()
    const now = new Date('2026-07-21T10:00:00Z')
    store.settings.quietHours.enabled = false
    store.settings.reminders = store.settings.reminders.map((item) => ({ ...item, enabled: true, nextTriggerAt: now.toISOString() }))
    store.initialized = true

    await store.tick(now, true)

    expect(store.pendingIds).toEqual(['stand'])
    expect(new Date(store.settings.reminders.find((item) => item.id === 'eye_rest')!.nextTriggerAt!).getTime()).toBeGreaterThan(now.getTime())
  })

  it('adds and deletes default or custom reminder projects', async () => {
    const store = useHealthStore()
    const now = new Date('2026-07-21T10:00:00Z')
    const custom = await store.addReminder({ title: '伸展肩颈', message: '活动一下肩颈。', intervalMinutes: 25, enabled: true }, now)
    expect(store.settings.reminders.at(-1)).toMatchObject({ id: custom.id, title: '伸展肩颈', intervalMinutes: 25 })
    await expect(store.updateReminder(custom.id, { intervalMinutes: 1 })).rejects.toThrow('reminder_interval_invalid')
    expect(store.settings.reminders.at(-1)?.intervalMinutes).toBe(25)

    store.pendingIds = ['stand', custom.id]
    store.completedToday.stand = 2
    await store.deleteReminder('stand')
    expect(store.settings.reminders.some((item) => item.id === 'stand')).toBe(false)
    expect(store.pendingIds).toEqual([custom.id])
    expect(store.completedToday.stand).toBeUndefined()

    await store.deleteReminder(custom.id)
    expect(store.settings.reminders.some((item) => item.id === custom.id)).toBe(false)
  })
})
