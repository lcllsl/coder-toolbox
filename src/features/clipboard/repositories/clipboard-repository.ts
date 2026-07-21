import Database from '@tauri-apps/plugin-sql'

import { isTauriRuntime } from '@/services/tauri/runtime'
import type { ClipboardItem, ClipboardQuery } from '../types'

const BROWSER_KEY = 'petal-toolbox.clipboard-items'
let database: Promise<Database> | undefined

interface ClipboardRow {
  id: string
  type: ClipboardItem['type']
  textContent?: string | null
  imagePath?: string | null
  contentHash: string
  previewText?: string | null
  createdAt: string
  updatedAt: string
  lastCopiedAt: string
  copyCount: number
  isFavorite: number
  isPinned: number
  isSensitive: number
  expiresAt?: string | null
}

function getDatabase() {
  database ??= Database.load('sqlite:petal-toolbox.db')
  return database
}

function browserItems(): ClipboardItem[] {
  try { return JSON.parse(localStorage.getItem(BROWSER_KEY) ?? '[]') as ClipboardItem[] }
  catch { return [] }
}

function saveBrowserItems(items: ClipboardItem[]) {
  localStorage.setItem(BROWSER_KEY, JSON.stringify(items))
}

function mapRow(row: ClipboardRow): ClipboardItem {
  return {
    id: row.id,
    type: row.type,
    textContent: row.textContent ?? undefined,
    imagePath: row.imagePath ?? undefined,
    contentHash: row.contentHash,
    previewText: row.previewText ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastCopiedAt: row.lastCopiedAt,
    copyCount: Number(row.copyCount),
    isFavorite: Boolean(row.isFavorite),
    isPinned: Boolean(row.isPinned),
    isSensitive: Boolean(row.isSensitive),
    expiresAt: row.expiresAt ?? undefined,
  }
}

export async function getLatestClipboardItem(): Promise<ClipboardItem | undefined> {
  if (!isTauriRuntime()) return browserItems().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  const rows = await (await getDatabase()).select<ClipboardRow[]>(
    `SELECT id, type, text_content AS textContent, image_path AS imagePath,
      content_hash AS contentHash, preview_text AS previewText,
      created_at AS createdAt, updated_at AS updatedAt, last_copied_at AS lastCopiedAt,
      copy_count AS copyCount, is_favorite AS isFavorite, is_pinned AS isPinned,
      is_sensitive AS isSensitive, expires_at AS expiresAt
     FROM clipboard_items ORDER BY updated_at DESC LIMIT 1`,
  )
  return rows[0] ? mapRow(rows[0]) : undefined
}

export async function insertClipboardItem(item: ClipboardItem): Promise<void> {
  if (!isTauriRuntime()) {
    saveBrowserItems([item, ...browserItems()])
    return
  }
  await (await getDatabase()).execute(
    `INSERT INTO clipboard_items
      (id, type, text_content, image_path, content_hash, preview_text,
       created_at, updated_at, last_copied_at, copy_count, is_favorite, is_pinned, is_sensitive, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [item.id, item.type, item.textContent, item.imagePath,
      item.contentHash, item.previewText, item.createdAt, item.updatedAt, item.lastCopiedAt,
      item.copyCount, Number(item.isFavorite), Number(item.isPinned), Number(item.isSensitive), item.expiresAt],
  )
}

export async function touchClipboardItem(id: string, at: string): Promise<void> {
  if (!isTauriRuntime()) {
    saveBrowserItems(browserItems().map((item) => item.id === id
      ? { ...item, updatedAt: at, lastCopiedAt: at, copyCount: item.copyCount + 1 }
      : item))
    return
  }
  await (await getDatabase()).execute(
    'UPDATE clipboard_items SET updated_at = $1, last_copied_at = $1, copy_count = copy_count + 1 WHERE id = $2',
    [at, id],
  )
}

export async function markClipboardItemCopied(id: string, at: string): Promise<void> {
  if (!isTauriRuntime()) {
    saveBrowserItems(browserItems().map((item) => item.id === id
      ? { ...item, lastCopiedAt: at, copyCount: item.copyCount + 1 }
      : item))
    return
  }
  await (await getDatabase()).execute(
    'UPDATE clipboard_items SET last_copied_at = $1, copy_count = copy_count + 1 WHERE id = $2',
    [at, id],
  )
}

export async function listClipboardItems(query: ClipboardQuery = {}): Promise<ClipboardItem[]> {
  if (!isTauriRuntime()) {
    const search = query.search?.toLocaleLowerCase()
    return browserItems()
      .filter((item) => !query.type || query.type === 'all' || item.type === query.type)
      .filter((item) => !query.favoritesOnly || item.isFavorite)
      .filter((item) => !search || item.textContent?.toLocaleLowerCase().includes(search) || item.previewText?.toLocaleLowerCase().includes(search))
      .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt.localeCompare(a.updatedAt))
  }
  const rows = await (await getDatabase()).select<ClipboardRow[]>(
    `SELECT id, type, text_content AS textContent, image_path AS imagePath,
      content_hash AS contentHash, preview_text AS previewText,
      created_at AS createdAt, updated_at AS updatedAt, last_copied_at AS lastCopiedAt,
      copy_count AS copyCount, is_favorite AS isFavorite, is_pinned AS isPinned,
      is_sensitive AS isSensitive, expires_at AS expiresAt
     FROM clipboard_items ORDER BY is_pinned DESC, updated_at DESC LIMIT 2200`,
  )
  const search = query.search?.toLocaleLowerCase()
  return rows.map(mapRow)
    .filter((item) => !query.type || query.type === 'all' || item.type === query.type)
    .filter((item) => !query.favoritesOnly || item.isFavorite)
    .filter((item) => !search || item.textContent?.toLocaleLowerCase().includes(search) || item.previewText?.toLocaleLowerCase().includes(search))
}

export async function setClipboardItemFlag(id: string, flag: 'isFavorite' | 'isPinned', value: boolean): Promise<void> {
  if (!isTauriRuntime()) {
    saveBrowserItems(browserItems().map((item) => item.id === id ? { ...item, [flag]: value } : item))
    return
  }
  const column = flag === 'isFavorite' ? 'is_favorite' : 'is_pinned'
  await (await getDatabase()).execute(`UPDATE clipboard_items SET ${column} = $1 WHERE id = $2`, [Number(value), id])
}

export async function deleteClipboardItems(ids: string[]): Promise<void> {
  if (!ids.length) return
  if (!isTauriRuntime()) {
    saveBrowserItems(browserItems().filter((item) => !ids.includes(item.id)))
    return
  }
  const db = await getDatabase()
  for (const id of ids) await db.execute('DELETE FROM clipboard_items WHERE id = $1', [id])
}

export async function clearUnprotectedClipboardItems(): Promise<void> {
  if (!isTauriRuntime()) {
    saveBrowserItems(browserItems().filter((item) => item.isFavorite || item.isPinned))
    return
  }
  await (await getDatabase()).execute('DELETE FROM clipboard_items WHERE is_favorite = 0 AND is_pinned = 0')
}

export async function clearAllClipboardItems(): Promise<string[]> {
  if (!isTauriRuntime()) {
    const imagePaths = browserItems().flatMap((item) => item.imagePath ? [item.imagePath] : [])
    saveBrowserItems([])
    return imagePaths
  }
  const db = await getDatabase()
  const images = await db.select<{ imagePath?: string | null }[]>('SELECT image_path AS imagePath FROM clipboard_items WHERE image_path IS NOT NULL')
  await db.execute('DELETE FROM clipboard_items')
  return images.flatMap((item) => item.imagePath ? [item.imagePath] : [])
}

export async function cleanupClipboardItems(now = new Date()): Promise<string[]> {
  if (!isTauriRuntime()) {
    const items = browserItems()
    const expired = items.filter((item) => !item.isFavorite && !item.isPinned && item.expiresAt && item.expiresAt <= now.toISOString())
    saveBrowserItems(items.filter((item) => !expired.includes(item)))
    return expired.flatMap((item) => item.imagePath ? [item.imagePath] : [])
  }
  const db = await getDatabase()
  const expired = await db.select<{ imagePath?: string | null }[]>(
    `SELECT image_path AS imagePath FROM clipboard_items
     WHERE is_favorite = 0 AND is_pinned = 0 AND expires_at IS NOT NULL AND expires_at <= $1`,
    [now.toISOString()],
  )
  await db.execute(
    'DELETE FROM clipboard_items WHERE is_favorite = 0 AND is_pinned = 0 AND expires_at IS NOT NULL AND expires_at <= $1',
    [now.toISOString()],
  )
  return expired.flatMap((item) => item.imagePath ? [item.imagePath] : [])
}

export async function pruneClipboardItems(maxTextItems: number, maxImageItems: number): Promise<string[]> {
  if (!isTauriRuntime()) {
    const items = browserItems()
    let textCount = 0
    let imageCount = 0
    const removed: ClipboardItem[] = []
    const kept = [...items]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter((item) => {
        if (item.isFavorite || item.isPinned) return true
        if (item.type === 'image') {
          imageCount += 1
          if (imageCount <= maxImageItems) return true
        } else {
          textCount += 1
          if (textCount <= maxTextItems) return true
        }
        removed.push(item)
        return false
      })
    saveBrowserItems(kept)
    return removed.flatMap((item) => item.imagePath ? [item.imagePath] : [])
  }
  const db = await getDatabase()
  const removedImages = await db.select<{ imagePath?: string | null }[]>(
    `SELECT image_path AS imagePath FROM clipboard_items
     WHERE type = 'image' AND is_favorite = 0 AND is_pinned = 0
     ORDER BY updated_at DESC LIMIT -1 OFFSET $1`,
    [maxImageItems],
  )
  await db.execute(
    `DELETE FROM clipboard_items WHERE id IN (
       SELECT id FROM clipboard_items WHERE type = 'image' AND is_favorite = 0 AND is_pinned = 0
       ORDER BY updated_at DESC LIMIT -1 OFFSET $1
     )`,
    [maxImageItems],
  )
  await db.execute(
    `DELETE FROM clipboard_items WHERE id IN (
       SELECT id FROM clipboard_items WHERE type != 'image' AND is_favorite = 0 AND is_pinned = 0
       ORDER BY updated_at DESC LIMIT -1 OFFSET $1
     )`,
    [maxTextItems],
  )
  return removedImages.flatMap((item) => item.imagePath ? [item.imagePath] : [])
}
