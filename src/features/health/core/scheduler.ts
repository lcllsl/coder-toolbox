import type { HealthSettings, NewReminderInput, QuietHours, ReminderConfig, ReminderId } from '../types'
import { REMINDER_PRIORITY } from '../types'

const MINUTE = 60_000

export function createDefaultReminders(now = new Date()): ReminderConfig[] {
  const definitions: Array<Omit<ReminderConfig, 'nextTriggerAt'>> = [
    { id: 'stand', enabled: true, intervalMinutes: 50, snoozeMinutes: 10, title: '起立活动', message: '站起来走动一下，让身体重新舒展。' },
    { id: 'water', enabled: true, intervalMinutes: 45, snoozeMinutes: 10, title: '喝水', message: '补充一些水分，给专注力充充电。' },
    { id: 'pelvic_floor', enabled: false, intervalMinutes: 60, snoozeMinutes: 10, title: '提肛训练', message: '进行一组轻量训练，保持核心活力。' },
    { id: 'eye_rest', enabled: true, intervalMinutes: 30, snoozeMinutes: 5, title: '远眺护眼', message: '看看远处 20 秒，让眼睛放松一下。' },
    { id: 'posture', enabled: false, intervalMinutes: 40, snoozeMinutes: 10, title: '坐姿调整', message: '放松肩颈，调整屏幕与坐姿。' },
  ]
  return definitions.map((config) => ({
    ...config,
    nextTriggerAt: new Date(now.getTime() + config.intervalMinutes * MINUTE).toISOString(),
  }))
}

export function createReminderConfig(id: ReminderId, input: NewReminderInput, now = new Date()): ReminderConfig {
  const title = input.title.trim()
  const message = input.message.trim()
  const intervalMinutes = Math.round(input.intervalMinutes)
  if (!title) throw new Error('reminder_title_required')
  if (!message) throw new Error('reminder_message_required')
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 1_440) {
    throw new Error('reminder_interval_invalid')
  }
  return {
    id,
    title,
    message,
    intervalMinutes,
    snoozeMinutes: 10,
    enabled: input.enabled,
    nextTriggerAt: new Date(now.getTime() + intervalMinutes * MINUTE).toISOString(),
  }
}

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function minutesOfDay(value: string): number {
  const [hours = 0, minutes = 0] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export function isInQuietHours(date: Date, quiet: QuietHours): boolean {
  if (!quiet.enabled || quiet.start === quiet.end) return false
  const current = date.getHours() * 60 + date.getMinutes()
  const start = minutesOfDay(quiet.start)
  const end = minutesOfDay(quiet.end)
  return start < end ? current >= start && current < end : current >= start || current < end
}

export function calculateNextTriggerAt(
  config: Pick<ReminderConfig, 'intervalMinutes' | 'snoozeMinutes'>,
  action: 'interval' | 'snooze',
  now = new Date(),
): string {
  const minutes = action === 'snooze' ? config.snoozeMinutes : config.intervalMinutes
  return new Date(now.getTime() + minutes * MINUTE).toISOString()
}

export function isHealthSuppressed(settings: HealthSettings, now = new Date()): boolean {
  if (settings.silentMode || settings.mutedDate === localDateKey(now)) return true
  if (settings.pausedUntil && new Date(settings.pausedUntil).getTime() > now.getTime()) return true
  return isInQuietHours(now, settings.quietHours)
}

export function getDueReminderIds(configs: readonly ReminderConfig[], now = new Date()): ReminderId[] {
  const due = new Set(
    configs
      .filter((config) => config.enabled && config.nextTriggerAt && new Date(config.nextTriggerAt).getTime() <= now.getTime())
      .map((config) => config.id),
  )
  const configuredOrder = configs.map((config) => config.id)
  const orderedIds = [...REMINDER_PRIORITY, ...configuredOrder.filter((id) => !REMINDER_PRIORITY.includes(id))]
  return orderedIds.filter((id) => due.has(id))
}

export function rescheduleReminder(config: ReminderConfig, action: 'interval' | 'snooze', now = new Date()): ReminderConfig {
  return {
    ...config,
    lastTriggeredAt: now.toISOString(),
    nextTriggerAt: calculateNextTriggerAt(config, action, now),
  }
}

export function normalizeSchedules(configs: readonly ReminderConfig[], now = new Date()): ReminderConfig[] {
  return configs.map((config) =>
    config.nextTriggerAt ? { ...config } : { ...config, nextTriggerAt: calculateNextTriggerAt(config, 'interval', now) },
  )
}
