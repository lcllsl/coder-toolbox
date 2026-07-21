import { load } from '@tauri-apps/plugin-store'

import { isTauriRuntime } from '@/services/tauri/runtime'
import type { ClipboardSettings } from '../types'

const STORE_KEY = 'clipboardSettings'
const BROWSER_KEY = 'petal-toolbox.clipboard-settings'

export function createDefaultClipboardSettings(): ClipboardSettings {
  return {
    paused: false,
    skipSensitive: true,
    textRetentionDays: 30,
    imageRetentionDays: 7,
    maxTextItems: 2000,
    maxImageItems: 200,
  }
}

export async function loadClipboardSettings(): Promise<ClipboardSettings> {
  const defaults = createDefaultClipboardSettings()
  try {
    const saved = isTauriRuntime()
      ? await (await load('settings.json')).get<Partial<ClipboardSettings>>(STORE_KEY)
      : JSON.parse(localStorage.getItem(BROWSER_KEY) ?? 'null') as Partial<ClipboardSettings> | null
    return saved ? { ...defaults, ...saved } : defaults
  } catch {
    return defaults
  }
}

export async function saveClipboardSettings(settings: ClipboardSettings): Promise<void> {
  if (isTauriRuntime()) {
    const store = await load('settings.json')
    await store.set(STORE_KEY, settings)
    await store.save()
  } else {
    localStorage.setItem(BROWSER_KEY, JSON.stringify(settings))
  }
}
