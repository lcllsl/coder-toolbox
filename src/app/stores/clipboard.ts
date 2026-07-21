import { defineStore } from 'pinia'

import { classifyClipboardText, createPreviewText, detectSensitiveText, hashClipboardImage, hashClipboardText, shouldMergeWithLatest } from '@/features/clipboard/core/content'
import {
  cleanupClipboardItems,
  clearAllClipboardItems,
  clearUnprotectedClipboardItems,
  deleteClipboardItems,
  getLatestClipboardItem,
  insertClipboardItem,
  listClipboardItems,
  markClipboardItemCopied,
  pruneClipboardItems,
  setClipboardItemFlag,
  touchClipboardItem,
} from '@/features/clipboard/repositories/clipboard-repository'
import {
  createDefaultClipboardSettings,
  loadClipboardSettings,
  saveClipboardSettings,
} from '@/features/clipboard/repositories/clipboard-settings-repository'
import type { ClipboardContentType, ClipboardItem, ClipboardQuery, ClipboardSettings } from '@/features/clipboard/types'
import {
  deleteClipboardImage,
  getClipboardSequenceNumber,
  readClipboardImage,
  readClipboardText,
  publishClipboardHistoryChanged,
  publishClipboardSettingsChanged,
  saveClipboardImage,
  writeCachedClipboardImage,
  writeClipboardText,
} from '@/services/tauri/clipboard'
import { isTauriRuntime } from '@/services/tauri/runtime'

const POLL_INTERVAL = 700
let pollTimer: number | undefined
let polling = false
let lastObservedHash = ''
let lastObservedSequence: number | null | undefined
let ignoredWrite: { text: string; until: number } | undefined
let ignoredImageHash: { hash: string; until: number } | undefined

export const useClipboardStore = defineStore('clipboard', {
  state: () => ({
    items: [] as ClipboardItem[],
    settings: createDefaultClipboardSettings() as ClipboardSettings,
    query: { type: 'all' } as ClipboardQuery,
    initialized: false,
    lastSkippedAt: undefined as string | undefined,
    selectedIds: [] as string[],
  }),
  getters: {
    selectedCount: (state) => state.selectedIds.length,
  },
  actions: {
    async initialize(startListener = false) {
      if (this.initialized) {
        if (startListener && isTauriRuntime()) this.startPolling()
        return
      }
      this.settings = await loadClipboardSettings()
      const expiredImagePaths = await cleanupClipboardItems()
      const prunedImagePaths = await pruneClipboardItems(this.settings.maxTextItems, this.settings.maxImageItems)
      await Promise.all([...expiredImagePaths, ...prunedImagePaths].map((path) => deleteClipboardImage(path)))
      const latest = await getLatestClipboardItem()
      lastObservedHash = latest?.contentHash ?? ''
      await this.reload()
      this.initialized = true
      if (startListener && isTauriRuntime()) this.startPolling()
    },
    startPolling() {
      if (pollTimer !== undefined) return
      pollTimer = window.setInterval(() => void this.poll(), POLL_INTERVAL)
      void this.poll()
    },
    stopPolling() {
      if (pollTimer !== undefined) window.clearInterval(pollTimer)
      pollTimer = undefined
    },
    async poll() {
      if (polling || this.settings.paused) return
      polling = true
      try {
        const sequence = await getClipboardSequenceNumber()
        if (sequence !== null && sequence === lastObservedSequence) return
        lastObservedSequence = sequence
        const text = await readClipboardText()
        if (text) {
          await this.ingestText(text)
          return
        }
        const image = await readClipboardImage()
        if (image) await this.ingestImage(image)
      } finally {
        polling = false
      }
    },
    async ingestText(text: string, now = new Date()) {
      const contentHash = hashClipboardText(text)
      if (contentHash === lastObservedHash) return
      lastObservedHash = contentHash
      if (ignoredWrite && ignoredWrite.until >= now.getTime() && ignoredWrite.text === text) {
        ignoredWrite = undefined
        return
      }
      if (this.settings.skipSensitive && detectSensitiveText(text)) {
        this.lastSkippedAt = now.toISOString()
        return
      }
      const latest = await getLatestClipboardItem()
      if (shouldMergeWithLatest(latest, contentHash, text) && latest) {
        await touchClipboardItem(latest.id, now.toISOString())
      } else {
        const expires = new Date(now)
        expires.setDate(expires.getDate() + this.settings.textRetentionDays)
        await insertClipboardItem({
          id: crypto.randomUUID(),
          type: classifyClipboardText(text),
          textContent: text,
          contentHash,
          previewText: createPreviewText(text),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          lastCopiedAt: now.toISOString(),
          copyCount: 1,
          isFavorite: false,
          isPinned: false,
          isSensitive: false,
          expiresAt: expires.toISOString(),
        })
      }
      const prunedImagePaths = await pruneClipboardItems(this.settings.maxTextItems, this.settings.maxImageItems)
      await Promise.all(prunedImagePaths.map((path) => deleteClipboardImage(path)))
      await this.reload()
      await publishClipboardHistoryChanged()
    },
    async ingestImage(image: { rgba: Uint8Array; width: number; height: number }, now = new Date()) {
      const contentHash = hashClipboardImage(image.rgba, image.width, image.height)
      if (contentHash === lastObservedHash) return
      lastObservedHash = contentHash
      if (ignoredImageHash && ignoredImageHash.until >= now.getTime() && ignoredImageHash.hash === contentHash) {
        ignoredImageHash = undefined
        return
      }
      const latest = await getLatestClipboardItem()
      if (latest?.type === 'image' && latest.contentHash === contentHash) {
        await touchClipboardItem(latest.id, now.toISOString())
      } else {
        const id = crypto.randomUUID()
        const imagePath = await saveClipboardImage(id, image)
        const expires = new Date(now)
        expires.setDate(expires.getDate() + this.settings.imageRetentionDays)
        await insertClipboardItem({
          id,
          type: 'image',
          imagePath,
          contentHash,
          previewText: `${image.width} × ${image.height}`,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          lastCopiedAt: now.toISOString(),
          copyCount: 1,
          isFavorite: false,
          isPinned: false,
          isSensitive: false,
          expiresAt: expires.toISOString(),
        })
      }
      const prunedImagePaths = await pruneClipboardItems(this.settings.maxTextItems, this.settings.maxImageItems)
      await Promise.all(prunedImagePaths.map((path) => deleteClipboardImage(path)))
      await this.reload()
      await publishClipboardHistoryChanged()
    },
    async reload() {
      this.items = await listClipboardItems(this.query)
      this.selectedIds = this.selectedIds.filter((id) => this.items.some((item) => item.id === id))
    },
    async setSearch(search: string) {
      this.query = { ...this.query, search }
      await this.reload()
    },
    async setType(type: ClipboardContentType | 'all') {
      this.query = { ...this.query, type }
      await this.reload()
    },
    async setFavoritesOnly(favoritesOnly: boolean) {
      this.query = { ...this.query, favoritesOnly }
      await this.reload()
    },
    async setPaused(paused: boolean) {
      const previous = this.settings.paused
      this.settings.paused = paused
      try {
        await saveClipboardSettings(this.settings)
        await publishClipboardSettingsChanged()
      } catch (error) {
        this.settings.paused = previous
        throw error
      }
    },
    async setSkipSensitive(skipSensitive: boolean) {
      const previous = this.settings.skipSensitive
      this.settings.skipSensitive = skipSensitive
      try {
        await saveClipboardSettings(this.settings)
        await publishClipboardSettingsChanged()
      } catch (error) {
        this.settings.skipSensitive = previous
        throw error
      }
    },
    async copyItem(item: ClipboardItem) {
      if (item.type === 'image' && item.imagePath) {
        ignoredImageHash = { hash: item.contentHash, until: Date.now() + 2_500 }
        await writeCachedClipboardImage(item.imagePath)
      } else if (item.textContent) {
        ignoredWrite = { text: item.textContent, until: Date.now() + 2_500 }
        await writeClipboardText(item.textContent)
      } else {
        throw new Error('clipboard_item_content_missing')
      }
      const at = new Date().toISOString()
      await markClipboardItemCopied(item.id, at)
      lastObservedHash = item.contentHash
      await this.reload()
    },
    async toggleFavorite(item: ClipboardItem) {
      await setClipboardItemFlag(item.id, 'isFavorite', !item.isFavorite)
      await this.reload()
    },
    async togglePinned(item: ClipboardItem) {
      await setClipboardItemFlag(item.id, 'isPinned', !item.isPinned)
      await this.reload()
    },
    toggleSelected(id: string) {
      this.selectedIds = this.selectedIds.includes(id)
        ? this.selectedIds.filter((selectedId) => selectedId !== id)
        : [...this.selectedIds, id]
    },
    clearSelection() {
      this.selectedIds = []
    },
    async deleteOne(id: string) {
      const imagePath = this.items.find((item) => item.id === id)?.imagePath
      await deleteClipboardItems([id])
      if (imagePath) await deleteClipboardImage(imagePath)
      await this.reload()
      await publishClipboardHistoryChanged()
    },
    async deleteSelected() {
      const imagePaths = this.items.filter((item) => this.selectedIds.includes(item.id)).flatMap((item) => item.imagePath ? [item.imagePath] : [])
      await deleteClipboardItems(this.selectedIds)
      await Promise.all(imagePaths.map((path) => deleteClipboardImage(path)))
      this.selectedIds = []
      await this.reload()
      await publishClipboardHistoryChanged()
    },
    async clearUnprotected() {
      const imagePaths = this.items.filter((item) => !item.isFavorite && !item.isPinned).flatMap((item) => item.imagePath ? [item.imagePath] : [])
      await clearUnprotectedClipboardItems()
      await Promise.all(imagePaths.map((path) => deleteClipboardImage(path)))
      await this.reload()
      await publishClipboardHistoryChanged()
    },
    async clearAllData() {
      const imagePaths = await clearAllClipboardItems()
      await Promise.all(imagePaths.map((path) => deleteClipboardImage(path)))
      this.selectedIds = []
      await this.reload()
      await publishClipboardHistoryChanged()
    },
    async resetSettings() {
      this.settings = createDefaultClipboardSettings()
      await saveClipboardSettings(this.settings)
      await publishClipboardSettingsChanged()
    },
    async reloadSettings() {
      this.settings = await loadClipboardSettings()
    },
  },
})
