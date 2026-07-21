import { load } from '@tauri-apps/plugin-store'

import { isTauriRuntime } from '@/services/tauri/runtime'
import { createDefaultReminders, normalizeSchedules } from '../core/scheduler'
import type { HealthSettings } from '../types'

const STORE_KEY = 'healthSettings'
const BROWSER_KEY = 'petal-toolbox.health-settings'

export function createDefaultHealthSettings(now = new Date()): HealthSettings {
  return {
    reminders: createDefaultReminders(now),
    silentMode: false,
    quietHours: { enabled: true, start: '22:00', end: '08:00' },
  }
}

export async function loadHealthSettings(): Promise<HealthSettings> {
  const defaults = createDefaultHealthSettings()
  try {
    const saved = isTauriRuntime()
      ? await (await load('settings.json')).get<HealthSettings>(STORE_KEY)
      : JSON.parse(localStorage.getItem(BROWSER_KEY) ?? 'null') as HealthSettings | null
    if (!saved) return defaults
    return { ...defaults, ...saved, quietHours: { ...defaults.quietHours, ...saved.quietHours }, reminders: normalizeSchedules(saved.reminders) }
  } catch {
    return defaults
  }
}

export async function saveHealthSettings(settings: HealthSettings): Promise<void> {
  if (isTauriRuntime()) {
    const store = await load('settings.json')
    await store.set(STORE_KEY, settings)
    await store.save()
  } else {
    localStorage.setItem(BROWSER_KEY, JSON.stringify(settings))
  }
}
