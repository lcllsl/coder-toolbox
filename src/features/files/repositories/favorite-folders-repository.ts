import { load } from '@tauri-apps/plugin-store'

import { isTauriRuntime } from '@/services/tauri/runtime'
import type { FavoriteFolder } from '../types'

const STORE_KEY = 'favoriteFolders'
const BROWSER_KEY = 'petal-toolbox.favorite-folders'

type StoredFolder = Omit<FavoriteFolder, 'exists' | 'system'>

export async function loadFavoriteFolders(): Promise<StoredFolder[]> {
  try {
    const saved = isTauriRuntime()
      ? await (await load('settings.json')).get<StoredFolder[]>(STORE_KEY)
      : JSON.parse(localStorage.getItem(BROWSER_KEY) ?? '[]') as StoredFolder[]
    return (saved ?? []).sort((a, b) => a.sortOrder - b.sortOrder)
  } catch {
    return []
  }
}

export async function saveFavoriteFolders(folders: FavoriteFolder[]): Promise<void> {
  const stored: StoredFolder[] = folders
    .filter((folder) => !folder.system)
    .map(({ id, name, path, sortOrder }) => ({ id, name, path, sortOrder }))
  if (isTauriRuntime()) {
    const store = await load('settings.json')
    await store.set(STORE_KEY, stored)
    await store.save()
  } else {
    localStorage.setItem(BROWSER_KEY, JSON.stringify(stored))
  }
}

