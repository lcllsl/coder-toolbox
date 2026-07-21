import { defineStore } from 'pinia'

import { fileNameFromPath } from '@/features/files/core/paths'
import { validateQuickUrl } from '@/features/quick-actions/core/quick-values'
import { loadQuickLinks, saveQuickLinks } from '@/features/quick-actions/repositories/quick-links-repository'
import { clearRecentFeatures, listRecentFeatures, touchRecentFeature } from '@/features/quick-actions/repositories/recent-features-repository'
import type { QuickLink, RecentFeature } from '@/features/quick-actions/types'
import { getApplicationStatus, openApplication, openExternalUrl } from '@/services/tauri/quick-actions'
import type { PanelCategory } from '@/types/navigation'

export const useQuickActionsStore = defineStore('quick-actions', {
  state: () => ({
    links: [] as QuickLink[],
    recent: [] as RecentFeature[],
    initialized: false,
  }),
  actions: {
    async initialize() {
      if (this.initialized) return
      const [links, recent] = await Promise.all([loadQuickLinks(), listRecentFeatures()])
      this.links = links
      this.recent = recent
      this.initialized = true
      await this.refreshApplicationStatuses()
    },
    async persistLinks() {
      await saveQuickLinks(this.links)
    },
    async addUrl(name: string, input: string, accent: string) {
      const result = validateQuickUrl(input)
      if (!result.value) throw new Error(result.error)
      if (this.links.some((link) => link.type === 'url' && link.target === result.value)) return false
      this.links.push({ id: crypto.randomUUID(), type: 'url', name: name.trim() || new URL(result.value).hostname,
        target: result.value, accent, sortOrder: this.links.length, enabled: true })
      await this.persistLinks()
      return true
    },
    async updateUrl(id: string, name: string, input: string, accent: string) {
      const item = this.links.find((link) => link.id === id && link.type === 'url')
      if (!item) throw new Error('quick_link_missing')
      const result = validateQuickUrl(input)
      if (!result.value) throw new Error(result.error)
      if (this.links.some((link) => link.id !== id && link.type === 'url' && link.target === result.value)) return false
      item.name = name.trim() || new URL(result.value).hostname
      item.target = result.value
      item.accent = accent
      item.enabled = true
      await this.persistLinks()
      return true
    },
    async addApplication(path: string) {
      if (this.links.some((link) => link.type === 'application' && link.target === path)) return false
      const status = await getApplicationStatus(path)
      if (!status.launchable) throw new Error('application_not_launchable')
      const rawName = fileNameFromPath(path) || '常用应用'
      const name = rawName.replace(/\.(app|exe|lnk)$/i, '')
      this.links.push({ id: crypto.randomUUID(), type: 'application', name, target: path,
        accent: '#6f72d8', sortOrder: this.links.length, enabled: true })
      await this.persistLinks()
      return true
    },
    async removeLink(id: string) {
      this.links = this.links.filter((link) => link.id !== id)
      this.links.forEach((link, index) => { link.sortOrder = index })
      await this.persistLinks()
    },
    async moveLink(id: string, direction: -1 | 1, type?: QuickLink['type']) {
      const ordered = [...this.links]
        .filter((link) => !type || link.type === type)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      const index = ordered.findIndex((link) => link.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= ordered.length) return
      const current = ordered[index]
      const other = ordered[target]
      if (!current || !other) return
      const order = current.sortOrder
      current.sortOrder = other.sortOrder
      other.sortOrder = order
      this.links.sort((a, b) => a.sortOrder - b.sortOrder)
      await this.persistLinks()
    },
    async refreshApplicationStatuses() {
      for (const link of this.links.filter((value) => value.type === 'application')) {
        const status = await getApplicationStatus(link.target)
        link.enabled = status.launchable
      }
    },
    async openLink(link: QuickLink) {
      if (!link.enabled) throw new Error('quick_link_unavailable')
      if (link.type === 'url') await openExternalUrl(link.target)
      else await openApplication(link.target)
      await this.recordRecent(`quick-link:${link.id}`, link.name, 'quick-actions')
    },
    async recordRecent(id: string, label: string, category: PanelCategory) {
      await touchRecentFeature(id, label, category)
      this.recent = await listRecentFeatures()
    },
    async clearRecent() {
      await clearRecentFeatures()
      this.recent = []
    },
    resetLinks() {
      this.links = []
    },
  },
})
