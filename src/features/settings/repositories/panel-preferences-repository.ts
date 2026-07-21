import { load } from '@tauri-apps/plugin-store'

import type { ThemePreference } from '@/app/stores/panel'
import { isTauriRuntime } from '@/services/tauri/runtime'
import type { PanelCategory } from '@/types/navigation'

export interface PanelPreferences {
  theme: ThemePreference
  favorites: PanelCategory[]
}

const STORE_KEY = 'panelPreferences'
const BROWSER_KEY = 'petal-toolbox.panel-preferences'

export async function loadPanelPreferences(): Promise<PanelPreferences | undefined> {
  try {
    return isTauriRuntime()
      ? await (await load('settings.json')).get<PanelPreferences>(STORE_KEY)
      : JSON.parse(localStorage.getItem(BROWSER_KEY) ?? 'null') as PanelPreferences | undefined
  } catch {
    return undefined
  }
}

export async function savePanelPreferences(preferences: PanelPreferences): Promise<void> {
  if (!isTauriRuntime()) {
    localStorage.setItem(BROWSER_KEY, JSON.stringify(preferences))
    return
  }
  const store = await load('settings.json')
  await store.set(STORE_KEY, preferences)
  await store.save()
}
