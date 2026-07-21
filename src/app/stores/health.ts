import { defineStore } from 'pinia'

import { publishHealthSettingsChanged } from '@/services/tauri/health'
import {
  calculateNextTriggerAt,
  getDueReminderIds,
  isHealthSuppressed,
  localDateKey,
  rescheduleReminder,
} from '@/features/health/core/scheduler'
import {
  createDefaultHealthSettings,
  loadHealthSettings,
  saveHealthSettings,
} from '@/features/health/repositories/health-settings-repository'
import {
  addReminderLog,
  clearReminderLogs,
  getTodayCompletedCounts,
} from '@/features/health/repositories/reminder-log-repository'
import type { HealthSettings, ReminderConfig, ReminderId } from '@/features/health/types'

export const useHealthStore = defineStore('health', {
  state: () => ({
    settings: createDefaultHealthSettings() as HealthSettings,
    completedToday: {} as Partial<Record<ReminderId, number>>,
    pendingIds: [] as ReminderId[],
    cardVisible: false,
    initialized: false,
  }),
  getters: {
    activeReminder(state): ReminderConfig | undefined {
      const id = state.pendingIds[0]
      return state.settings.reminders.find((reminder) => reminder.id === id)
    },
    pendingCount: (state) => state.pendingIds.length,
    totalCompletedToday: (state) =>
      Object.values(state.completedToday).reduce<number>((total, count) => total + (count ?? 0), 0),
  },
  actions: {
    async initialize() {
      this.settings = await loadHealthSettings()
      this.completedToday = await getTodayCompletedCounts()
      this.initialized = true
    },
    async reloadSettings() {
      this.settings = await loadHealthSettings()
    },
    async persist(notify = true) {
      await saveHealthSettings(this.settings)
      if (notify) await publishHealthSettingsChanged()
    },
    async updateReminder(id: ReminderId, patch: Partial<Pick<ReminderConfig, 'enabled' | 'intervalMinutes' | 'snoozeMinutes'>>) {
      const now = new Date()
      this.settings.reminders = this.settings.reminders.map((reminder) =>
        reminder.id === id
          ? { ...reminder, ...patch, nextTriggerAt: calculateNextTriggerAt({ ...reminder, ...patch }, 'interval', now) }
          : reminder,
      )
      await this.persist()
    },
    async setSilentMode(enabled: boolean) {
      this.settings.silentMode = enabled
      await this.persist()
    },
    async updateQuietHours(patch: Partial<HealthSettings['quietHours']>) {
      this.settings.quietHours = { ...this.settings.quietHours, ...patch }
      await this.persist()
    },
    async pause(minutes: 30 | 60) {
      this.settings.pausedUntil = new Date(Date.now() + minutes * 60_000).toISOString()
      this.cardVisible = false
      await this.persist()
    },
    async muteToday() {
      this.settings.mutedDate = localDateKey()
      this.cardVisible = false
      await this.persist()
    },
    async tick(now = new Date(), onlyHighestPriority = false) {
      if (!this.initialized || this.pendingIds.length) return
      const due = getDueReminderIds(this.settings.reminders, now)
      if (!due.length) return
      if (isHealthSuppressed(this.settings, now)) {
        this.settings.reminders = this.settings.reminders.map((reminder) =>
          due.includes(reminder.id) ? rescheduleReminder(reminder, 'interval', now) : reminder,
        )
        await this.persist(false)
        return
      }
      if (onlyHighestPriority && due.length > 1) {
        const [highest, ...skipped] = due
        this.settings.reminders = this.settings.reminders.map((reminder) =>
          skipped.includes(reminder.id) ? rescheduleReminder(reminder, 'interval', now) : reminder,
        )
        this.pendingIds = highest ? [highest] : []
        await this.persist(false)
      } else {
        this.pendingIds = due
      }
      this.cardVisible = true
    },
    async completeActive(now = new Date()) {
      const id = this.pendingIds[0]
      if (!id) return
      const reminder = this.settings.reminders.find((item) => item.id === id)
      if (!reminder) return
      await addReminderLog(id, 'completed', now)
      this.completedToday[id] = (this.completedToday[id] ?? 0) + 1
      this.settings.reminders = this.settings.reminders.map((item) =>
        item.id === id ? rescheduleReminder(item, 'interval', now) : item,
      )
      this.pendingIds = this.pendingIds.slice(1)
      this.cardVisible = this.pendingIds.length > 0
      await this.persist(false)
    },
    async snoozeActive(now = new Date()) {
      const id = this.pendingIds[0]
      if (!id) return
      await addReminderLog(id, 'snoozed', now)
      this.settings.reminders = this.settings.reminders.map((item) =>
        item.id === id ? rescheduleReminder(item, 'snooze', now) : item,
      )
      this.pendingIds = this.pendingIds.slice(1)
      this.cardVisible = this.pendingIds.length > 0
      await this.persist(false)
    },
    async autoHideActive(now = new Date()) {
      const id = this.pendingIds[0]
      if (!id || !this.cardVisible) return
      await addReminderLog(id, 'auto_hidden', now)
      this.cardVisible = false
    },
    showPendingCard() {
      if (this.pendingIds.length) this.cardVisible = true
    },
    triggerDebugReminder(id: ReminderId) {
      this.pendingIds = [id, ...this.pendingIds.filter((pendingId) => pendingId !== id)]
      this.cardVisible = true
    },
    hidePendingCard() {
      this.cardVisible = false
    },
    async clearStatistics() {
      await clearReminderLogs()
      this.completedToday = {}
    },
    async resetSettings() {
      this.settings = createDefaultHealthSettings()
      this.pendingIds = []
      this.cardVisible = false
      await this.persist()
    },
  },
})
