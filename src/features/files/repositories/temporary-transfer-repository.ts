import Database from '@tauri-apps/plugin-sql'

import type { TemporaryTransferItem } from '@/features/files/types'
import { isTauriRuntime } from '@/services/tauri/runtime'

const BROWSER_KEY = 'petal-toolbox.temporary-transfer-items'
let database: Promise<Database> | undefined

interface TemporaryTransferRow {
  id: string
  name: string
  originalPath: string
  storedPath: string
  kind: TemporaryTransferItem['kind']
  sizeBytes: number
  addedAt: string
  expiresAt: string
  isPinned: number
}

function getDatabase() {
  database ??= Database.load('sqlite:petal-toolbox.db')
  return database
}

function browserItems(): TemporaryTransferItem[] {
  try { return JSON.parse(localStorage.getItem(BROWSER_KEY) ?? '[]') as TemporaryTransferItem[] }
  catch { return [] }
}

function saveBrowserItems(items: TemporaryTransferItem[]) {
  localStorage.setItem(BROWSER_KEY, JSON.stringify(items))
}

function mapRow(row: TemporaryTransferRow): TemporaryTransferItem {
  return { ...row, sizeBytes: Number(row.sizeBytes), isPinned: Boolean(row.isPinned) }
}

export async function listTemporaryTransferItems(): Promise<TemporaryTransferItem[]> {
  if (!isTauriRuntime()) return browserItems().sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  const rows = await (await getDatabase()).select<TemporaryTransferRow[]>(
    `SELECT id, name, original_path AS originalPath, stored_path AS storedPath, kind,
      size_bytes AS sizeBytes, added_at AS addedAt, expires_at AS expiresAt, is_pinned AS isPinned
     FROM temporary_transfer_items ORDER BY is_pinned DESC, added_at DESC`,
  )
  return rows.map(mapRow)
}

export async function insertTemporaryTransferItem(item: TemporaryTransferItem): Promise<void> {
  if (!isTauriRuntime()) {
    saveBrowserItems([item, ...browserItems().filter((value) => value.id !== item.id)])
    return
  }
  await (await getDatabase()).execute(
    `INSERT INTO temporary_transfer_items
      (id, name, original_path, stored_path, kind, size_bytes, added_at, expires_at, is_pinned)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [item.id, item.name, item.originalPath, item.storedPath, item.kind, item.sizeBytes,
      item.addedAt, item.expiresAt, Number(item.isPinned)],
  )
}

export async function setTemporaryTransferPinned(id: string, isPinned: boolean): Promise<void> {
  if (!isTauriRuntime()) {
    saveBrowserItems(browserItems().map((item) => item.id === id ? { ...item, isPinned } : item))
    return
  }
  await (await getDatabase()).execute(
    'UPDATE temporary_transfer_items SET is_pinned = $1 WHERE id = $2',
    [Number(isPinned), id],
  )
}

export async function deleteTemporaryTransferItem(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    saveBrowserItems(browserItems().filter((item) => item.id !== id))
    return
  }
  await (await getDatabase()).execute('DELETE FROM temporary_transfer_items WHERE id = $1', [id])
}
