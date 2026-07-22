export const DEFAULT_REMINDER_IDS = ['stand', 'water', 'pelvic_floor', 'eye_rest', 'posture'] as const
export type ReminderId = string
export type ReminderAction = 'completed' | 'snoozed' | 'dismissed' | 'auto_hidden'

export interface NewReminderInput {
  title: string
  message: string
  intervalMinutes: number
  enabled: boolean
}

export interface ReminderConfig {
  id: ReminderId
  enabled: boolean
  intervalMinutes: number
  snoozeMinutes: number
  title: string
  message: string
  lastTriggeredAt?: string
  nextTriggerAt?: string
}

export interface ReminderLog {
  id: string
  reminderId: ReminderId
  action: ReminderAction
  occurredAt: string
}

export interface QuietHours {
  enabled: boolean
  start: string
  end: string
}

export interface HealthSettings {
  reminders: ReminderConfig[]
  silentMode: boolean
  quietHours: QuietHours
  pausedUntil?: string
  mutedDate?: string
}

export const REMINDER_PRIORITY: readonly ReminderId[] = [
  'stand',
  'eye_rest',
  'water',
  'posture',
  'pelvic_floor',
]
