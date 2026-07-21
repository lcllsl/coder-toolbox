import { defineStore } from 'pinia'

import { loadPanelPreferences, savePanelPreferences } from '@/features/settings/repositories/panel-preferences-repository'
import type { PanelCategory } from '@/types/navigation'

export type PanelView = PanelCategory | 'settings'
export type ThemePreference = 'system' | 'light' | 'dark'

export const usePanelStore = defineStore('panel', {
  state: () => ({
    activeView: 'quick-actions' as PanelView,
    theme: 'system' as ThemePreference,
    favorites: [] as PanelCategory[],
    initialized: false,
  }),
  actions: {
    selectView(view: PanelView) {
      this.activeView = view
    },
    async initialize() {
      if (this.initialized) return
      const saved = await loadPanelPreferences()
      if (saved) {
        this.theme = saved.theme
        this.favorites = saved.favorites
      }
      this.initialized = true
      this.applyTheme()
    },
    applyTheme() {
      if (this.theme === 'system') delete document.documentElement.dataset.theme
      else document.documentElement.dataset.theme = this.theme
    },
    async persist() {
      await savePanelPreferences({ theme: this.theme, favorites: this.favorites })
    },
    async setTheme(theme: ThemePreference) {
      this.theme = theme
      this.applyTheme()
      await this.persist()
    },
    async toggleFavorite(category: PanelCategory) {
      this.favorites = this.favorites.includes(category)
        ? this.favorites.filter((favorite) => favorite !== category)
        : [...this.favorites, category]
      await this.persist()
    },
    async resetPreferences() {
      this.theme = 'system'
      this.favorites = []
      this.applyTheme()
      await this.persist()
    },
  },
})
