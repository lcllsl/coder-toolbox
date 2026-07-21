import { defineStore } from 'pinia'

import { useClipboardStore } from '@/app/stores/clipboard'
import { useFilesStore } from '@/app/stores/files'
import { useHealthStore } from '@/app/stores/health'
import { usePanelStore } from '@/app/stores/panel'
import { useQuickActionsStore } from '@/app/stores/quick-actions'
import { clearAllSettings, createDefaultAppSettings, loadAppSettings, saveAppSettings } from '@/features/settings/repositories/app-settings-repository'
import type { AppMode, AppSettings, DoubleClickAction } from '@/features/settings/types'
import { getAutostartEnabled, publishAppSettingsChanged, replaceGlobalShortcut, setAutostart, updateTrayMode } from '@/services/tauri/settings'

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    settings: createDefaultAppSettings() as AppSettings,
    initialized: false,
  }),
  actions: {
    async initialize() {
      if (this.initialized) return
      this.settings = await loadAppSettings()
      try { this.settings.autostart = await getAutostartEnabled() }
      catch { /* Keep the persisted display value when the platform query fails. */ }
      this.initialized = true
    },
    async reload() {
      this.settings = await loadAppSettings()
    },
    async persist(notify = true) {
      await saveAppSettings(this.settings)
      if (notify) await publishAppSettingsChanged()
    },
    async setMode(mode: AppMode) {
      this.settings.mode = mode
      await this.persist()
      await updateTrayMode(mode)
    },
    async setGlobalShortcut(shortcut: string) {
      const normalized = shortcut.trim()
      if (!normalized) throw new Error('shortcut_empty')
      await replaceGlobalShortcut(normalized, this.settings.globalShortcut)
      this.settings.globalShortcut = normalized
      await this.persist()
    },
    async setDoubleClickAction(action: DoubleClickAction) {
      this.settings.doubleClickAction = action
      await this.persist()
    },
    async setAutostart(enabled: boolean) {
      await setAutostart(enabled)
      this.settings.autostart = enabled
      await this.persist(false)
    },
    async setOrbAppearance(size: number, opacity: number) {
      this.settings.orbSize = Math.min(68, Math.max(48, size))
      this.settings.orbOpacity = Math.min(1, Math.max(.6, opacity))
      await this.persist()
    },
    async clearLocalData(resetSettings: boolean) {
      const clipboard = useClipboardStore()
      const health = useHealthStore()
      const files = useFilesStore()
      const quick = useQuickActionsStore()
      const panel = usePanelStore()
      await Promise.all([
        clipboard.initialize(false),
        health.initialize(),
        files.initialize(),
        quick.initialize(),
        panel.initialize(),
      ])
      await Promise.all([
        clipboard.clearAllData(),
        health.clearStatistics(),
        files.clearAllTransfers(),
        quick.clearRecent(),
      ])
      if (!resetSettings) return

      const defaults = createDefaultAppSettings()
      if (this.settings.autostart) await setAutostart(false)
      await replaceGlobalShortcut(defaults.globalShortcut, this.settings.globalShortcut)
      await clearAllSettings()
      this.settings = defaults
      files.resetFavoriteFolders()
      quick.resetLinks()
      await Promise.all([
        this.persist(),
        clipboard.resetSettings(),
        health.resetSettings(),
        panel.resetPreferences(),
      ])
      await updateTrayMode('work')
    },
  },
})
