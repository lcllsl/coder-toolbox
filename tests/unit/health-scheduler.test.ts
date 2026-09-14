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
import {
  hasReminderWindowElapsed,
  REMINDER_AUTO_COMPLETE_MS,
  REMINDER_AUTO_COMPLETE_SECONDS,
} from '@/features/health/core/reminder-timing'
import { createDefaultHealthSettings, loadHealthSettings } from '@/features/health/repositories/health-settings-repository'

describe('health reminder scheduler', () => {
  it('uses a thirty-second automatic completion window', () => {
    expect(REMINDER_AUTO_COMPLETE_SECONDS).toBe(30)
    expect(REMINDER_AUTO_COMPLETE_MS).toBe(30_000)
    expect(hasReminderWindowElapsed('2026-07-21T08:00:00.000Z', new Date('2026-07-21T08:00:30.000Z'))).toBe(true)
  })

  it('creates the four documented defaults', () => {
    const reminders = createDefaultReminders(new Date('2026-07-21T08:00:00Z'))
    expect(reminders.map(({ id, enabled, intervalMinutes }) => ({ id, enabled, intervalMinutes }))).toEqual([
      { id: 'stand', enabled: true, intervalMinutes: 50 },
      { id: 'water', enabled: true, intervalMinutes: 45 },
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
    expect(getDueReminderIds(reminders, now)).toEqual(['stand', 'eye_rest', 'water', 'posture'])
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

  it('removes the retired pelvic-floor default from previously saved settings', async () => {
    const now = new Date('2026-07-21T10:00:00Z')
    const settings = createDefaultHealthSettings(now)
    settings.reminders.push({
      id: 'pelvic_floor', enabled: false, intervalMinutes: 60, snoozeMinutes: 10,
      title: '提肛训练', message: '进行一组训练。', nextTriggerAt: now.toISOString(),
    })
    localStorage.setItem('petal-toolbox.health-settings', JSON.stringify(settings))

    const loaded = await loadHealthSettings()

    expect(loaded.reminders.map((reminder) => reminder.id)).toEqual(['stand', 'water', 'eye_rest', 'posture'])
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

  it('queues every due reminder with an independent background deadline', async () => {
    const store = useHealthStore()
    const now = new Date('2026-07-21T10:00:00Z')
    store.settings.quietHours.enabled = false
    store.settings.reminders = store.settings.reminders.map((item) => ({ ...item, enabled: true, nextTriggerAt: now.toISOString() }))
    store.initialized = true

    await store.tick(now)

    expect(store.pendingIds).toEqual(['stand', 'eye_rest', 'water', 'posture'])
    expect(new Set(Object.values(store.pendingAutoCompleteAt))).toEqual(new Set(['2026-07-21T10:00:30.000Z']))
  })

  it('starts later reminders while the first card is still pending and expires each on schedule', async () => {
    const store = useHealthStore()
    const start = new Date('2026-07-21T10:00:00Z')
    store.settings.quietHours.enabled = false
    store.settings.reminders = store.settings.reminders.map((item) => ({
      ...item,
      enabled: item.id === 'stand' || item.id === 'water',
      nextTriggerAt: new Date(start.getTime() + (item.id === 'water' ? 10_000 : 0)).toISOString(),
    }))
    store.initialized = true

    await store.tick(start)
    await store.tick(new Date(start.getTime() + 10_000))
    expect(store.pendingIds).toEqual(['stand', 'water'])
    expect(store.pendingAutoCompleteAt).toMatchObject({
      stand: '2026-07-21T10:00:30.000Z',
      water: '2026-07-21T10:00:40.000Z',
    })

    await store.completeExpired(new Date(start.getTime() + 30_000))
    expect(store.pendingIds).toEqual(['water'])
    expect(store.completedToday.stand).toBe(1)
    await store.completeExpired(new Date(start.getTime() + 40_000))
    expect(store.pendingIds).toEqual([])
    expect(store.completedToday.water).toBe(1)
  })

  it('discards reminders missed while the system was asleep without counting them as completed', async () => {
    const store = useHealthStore()
    const now = new Date('2026-07-21T10:00:00Z')
    store.settings.quietHours.enabled = false
    store.settings.reminders = store.settings.reminders.map((item) => ({
      ...item,
      enabled: item.id === 'stand' || item.id === 'water',
      nextTriggerAt: now.toISOString(),
    }))
    store.initialized = true

    await store.tick(now, true)

    expect(store.pendingIds).toEqual([])
    expect(store.cardVisible).toBe(false)
    expect(store.completedToday).toEqual({})
    expect(store.settings.reminders.find((item) => item.id === 'stand')?.nextTriggerAt).toBe('2026-07-21T10:50:00.000Z')
    expect(store.settings.reminders.find((item) => item.id === 'water')?.nextTriggerAt).toBe('2026-07-21T10:45:00.000Z')
    expect(localStorage.getItem('petal-toolbox.reminder-logs')).toBeNull()
  })

  it('discards a reminder whose display window elapsed before the app checked it', async () => {
    const store = useHealthStore()
    const now = new Date('2026-07-21T10:00:31Z')
    store.settings.quietHours.enabled = false
    store.settings.reminders = store.settings.reminders.map((item) => ({
      ...item,
      enabled: item.id === 'stand',
      nextTriggerAt: '2026-07-21T10:00:00.000Z',
    }))
    store.initialized = true

    await store.tick(now)

    expect(store.pendingIds).toEqual([])
    expect(store.completedToday.stand).toBeUndefined()
    expect(store.settings.reminders.find((item) => item.id === 'stand')?.nextTriggerAt).toBe('2026-07-21T10:50:31.000Z')
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
