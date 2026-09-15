import { load } from '@tauri-apps/plugin-store'
import { isTauriRuntime } from '@/services/tauri/runtime'
import type { ClassificationDictionary } from '../types'

const STORE_KEY = 'smartFileOrganizerDictionaries'
const BROWSER_KEY = 'petal-toolbox.smart-file-organizer-dictionaries'

export async function loadDictionaries(): Promise<ClassificationDictionary> {
  try {
    if (!isTauriRuntime()) return JSON.parse(localStorage.getItem(BROWSER_KEY) ?? '{}') as ClassificationDictionary
    return await (await load('settings.json')).get<ClassificationDictionary>(STORE_KEY) ?? {}
  } catch { return {} }
}

export async function saveDictionaries(value: ClassificationDictionary): Promise<void> {
  if (!isTauriRuntime()) { localStorage.setItem(BROWSER_KEY, JSON.stringify(value)); return }
  const store = await load('settings.json')
  await store.set(STORE_KEY, value)
  await store.save()
}

