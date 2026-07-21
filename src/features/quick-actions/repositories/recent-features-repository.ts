import Database from '@tauri-apps/plugin-sql'

import { isTauriRuntime } from '@/services/tauri/runtime'
import type { PanelCategory } from '@/types/navigation'
import type { RecentFeature } from '../types'

const BROWSER_KEY = 'petal-toolbox.recent-features'
let database: Promise<Database> | undefined

interface RecentFeatureRow {
  id: string
  label: string
  category: PanelCategory
  usedAt: string
  useCount: number
}

function getDatabase() {
  database ??= Database.load('sqlite:petal-toolbox.db')
  return database
}

function browserItems(): RecentFeature[] {
  try { return JSON.parse(localStorage.getItem(BROWSER_KEY) ?? '[]') as RecentFeature[] }
  catch { return [] }
}

function saveBrowserItems(items: RecentFeature[]) {
  localStorage.setItem(BROWSER_KEY, JSON.stringify(items.slice(0, 8)))
}

export async function listRecentFeatures(): Promise<RecentFeature[]> {
  if (!isTauriRuntime()) return browserItems().sort((a, b) => b.usedAt.localeCompare(a.usedAt)).slice(0, 8)
  const rows = await (await getDatabase()).select<RecentFeatureRow[]>(
    `SELECT id, label, category, used_at AS usedAt, use_count AS useCount
     FROM recent_features ORDER BY used_at DESC LIMIT 8`,
  )
  return rows.map((row) => ({ ...row, useCount: Number(row.useCount) }))
}

export async function touchRecentFeature(id: string, label: string, category: PanelCategory, usedAt = new Date().toISOString()): Promise<void> {
  if (!isTauriRuntime()) {
    const existing = browserItems().find((item) => item.id === id)
    saveBrowserItems([
      { id, label, category, usedAt, useCount: (existing?.useCount ?? 0) + 1 },
      ...browserItems().filter((item) => item.id !== id),
    ])
    return
  }
  await (await getDatabase()).execute(
    `INSERT INTO recent_features (id, label, category, used_at, use_count)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT(id) DO UPDATE SET label = $2, category = $3, used_at = $4, use_count = use_count + 1`,
    [id, label, category, usedAt],
  )
}

export async function clearRecentFeatures(): Promise<void> {
  if (!isTauriRuntime()) {
    saveBrowserItems([])
    return
  }
  await (await getDatabase()).execute('DELETE FROM recent_features')
}
