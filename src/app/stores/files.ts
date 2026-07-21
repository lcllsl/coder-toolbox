import { defineStore } from 'pinia'

import { fileNameFromPath, transferExpiryDate } from '@/features/files/core/paths'
import { loadFavoriteFolders, saveFavoriteFolders } from '@/features/files/repositories/favorite-folders-repository'
import { deleteTemporaryTransferItem, insertTemporaryTransferItem, listTemporaryTransferItems, setTemporaryTransferPinned } from '@/features/files/repositories/temporary-transfer-repository'
import type { FavoriteFolder, TemporaryTransferItem } from '@/features/files/types'
import { copyToTemporaryTransfer, deleteTemporaryTransferCopy, getDirectoryStatus, getSystemDirectories, openDirectory, openTemporaryTransferCopy } from '@/services/tauri/files'

export const useFilesStore = defineStore('files', {
  state: () => ({
    folders: [] as FavoriteFolder[],
    transferItems: [] as TemporaryTransferItem[],
    initialized: false,
    transferring: false,
  }),
  getters: {
    systemFolders: (state) => state.folders.filter((folder) => folder.system),
    customFolders: (state) => state.folders.filter((folder) => !folder.system).sort((a, b) => a.sortOrder - b.sortOrder),
  },
  actions: {
    async initialize() {
      if (this.initialized) return
      const [system, saved, transferItems] = await Promise.all([
        getSystemDirectories(), loadFavoriteFolders(), listTemporaryTransferItems(),
      ])
      const systemFolders: FavoriteFolder[] = [
        system.downloads ? { id: 'system-downloads', name: '下载', path: system.downloads, sortOrder: -3, exists: true, system: true } : undefined,
        system.desktop ? { id: 'system-desktop', name: '桌面', path: system.desktop, sortOrder: -2, exists: true, system: true } : undefined,
        system.documents ? { id: 'system-documents', name: '文档', path: system.documents, sortOrder: -1, exists: true, system: true } : undefined,
      ].filter((folder): folder is FavoriteFolder => Boolean(folder))
      this.folders = [...systemFolders, ...saved.map((folder) => ({ ...folder, exists: true }))]
      this.transferItems = transferItems
      this.initialized = true
      await Promise.all([this.refreshStatuses(), this.cleanupExpiredTransfers()])
    },
    async refreshStatuses() {
      this.folders = await Promise.all(this.folders.map(async (folder) => {
        const status = await getDirectoryStatus(folder.path)
        return { ...folder, exists: status.exists && status.isDirectory }
      }))
    },
    async persist() {
      await saveFavoriteFolders(this.folders)
    },
    async addFolder(path: string) {
      if (this.folders.some((folder) => folder.path === path)) return false
      const nextOrder = this.customFolders.reduce((maximum, folder) => Math.max(maximum, folder.sortOrder), -1) + 1
      this.folders.push({ id: crypto.randomUUID(), name: fileNameFromPath(path) || '常用文件夹', path, sortOrder: nextOrder, exists: true })
      await this.persist()
      return true
    },
    async renameFolder(id: string, name: string) {
      const normalized = name.trim()
      if (!normalized) return
      this.folders = this.folders.map((folder) => folder.id === id ? { ...folder, name: normalized } : folder)
      await this.persist()
    },
    async removeFolder(id: string) {
      this.folders = this.folders.filter((folder) => folder.id !== id)
      this.customFolders.forEach((folder, index) => { folder.sortOrder = index })
      await this.persist()
    },
    async moveFolder(id: string, direction: -1 | 1) {
      const custom = this.customFolders
      const index = custom.findIndex((folder) => folder.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= custom.length) return
      const current = custom[index]
      const other = custom[target]
      if (!current || !other) return
      const order = current.sortOrder
      current.sortOrder = other.sortOrder
      other.sortOrder = order
      await this.persist()
    },
    async openFolder(folder: FavoriteFolder) {
      const status = await getDirectoryStatus(folder.path)
      folder.exists = status.exists && status.isDirectory
      if (!folder.exists) throw new Error('directory_missing')
      await openDirectory(folder.path)
    },
    async addTransferPaths(paths: string[]) {
      const uniquePaths = [...new Set(paths.filter(Boolean))]
      if (!uniquePaths.length || this.transferring) return { added: 0, failed: 0 }
      this.transferring = true
      let added = 0
      let failed = 0
      try {
        for (const originalPath of uniquePaths) {
          const id = crypto.randomUUID()
          try {
            const copy = await copyToTemporaryTransfer(originalPath, id)
            const addedAt = new Date().toISOString()
            const item: TemporaryTransferItem = {
              id,
              name: fileNameFromPath(originalPath) || '未命名项目',
              originalPath,
              storedPath: copy.storedPath,
              kind: copy.kind,
              sizeBytes: copy.sizeBytes,
              addedAt,
              expiresAt: transferExpiryDate(addedAt) ?? addedAt,
              isPinned: false,
            }
            await insertTemporaryTransferItem(item)
            this.transferItems.unshift(item)
            added += 1
          } catch {
            await deleteTemporaryTransferCopy(id).catch(() => undefined)
            failed += 1
          }
        }
      } finally {
        this.transferring = false
      }
      return { added, failed }
    },
    async toggleTransferPinned(item: TemporaryTransferItem) {
      const isPinned = !item.isPinned
      await setTemporaryTransferPinned(item.id, isPinned)
      item.isPinned = isPinned
      this.transferItems.sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.addedAt.localeCompare(a.addedAt))
    },
    async deleteTransfer(item: TemporaryTransferItem) {
      await deleteTemporaryTransferCopy(item.id)
      await deleteTemporaryTransferItem(item.id)
      this.transferItems = this.transferItems.filter((value) => value.id !== item.id)
    },
    async openTransfer(item: TemporaryTransferItem) {
      await openTemporaryTransferCopy(item.id)
    },
    async cleanupExpiredTransfers(now = new Date()) {
      const expired = this.transferItems.filter((item) => !item.isPinned && item.expiresAt <= now.toISOString())
      for (const item of expired) {
        try { await this.deleteTransfer(item) }
        catch { /* Keep metadata so cleanup can retry next time. */ }
      }
      return expired.length
    },
    async clearAllTransfers() {
      for (const item of [...this.transferItems]) await this.deleteTransfer(item)
    },
    resetFavoriteFolders() {
      this.folders = this.folders.filter((folder) => folder.system)
    },
  },
})
