import { load } from '@tauri-apps/plugin-store'

import { isTauriRuntime } from '@/services/tauri/runtime'
import type { QuickLink } from '../types'

const STORE_KEY = 'quickLinks'
const BROWSER_KEY = 'petal-toolbox.quick-links'

export async function loadQuickLinks(): Promise<QuickLink[]> {
  try {
    const links = isTauriRuntime()
      ? await (await load('settings.json')).get<QuickLink[]>(STORE_KEY)
      : JSON.parse(localStorage.getItem(BROWSER_KEY) ?? '[]') as QuickLink[]
    return (links ?? []).sort((a, b) => a.sortOrder - b.sortOrder)
  } catch {
    return []
  }
}

export async function saveQuickLinks(links: QuickLink[]): Promise<void> {
  if (!isTauriRuntime()) {
    localStorage.setItem(BROWSER_KEY, JSON.stringify(links))
    return
  }
  const store = await load('settings.json')
  await store.set(STORE_KEY, links)
  await store.save()
}
