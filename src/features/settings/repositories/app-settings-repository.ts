import { load } from '@tauri-apps/plugin-store'

import { isTauriRuntime } from '@/services/tauri/runtime'
import type { AppSettings, VaultAutoLockMinutes } from '../types'

const STORE_KEY = 'appSettings'
const BROWSER_KEY = 'petal-toolbox.app-settings'
const DEFAULT_VAULT_AUTO_LOCK_MINUTES: VaultAutoLockMinutes = 5
const VAULT_AUTO_LOCK_OPTIONS = new Set<VaultAutoLockMinutes>([1, 5, 15, 30])

export function shouldConfigureVaultAutoLock(
  nativeRuntime: boolean,
  windowLabel: 'orb-window' | 'panel-window',
): boolean {
  return !nativeRuntime || windowLabel === 'panel-window'
}

export function normalizeVaultAutoLockMinutes(value: unknown): VaultAutoLockMinutes {
  return typeof value === 'number' && VAULT_AUTO_LOCK_OPTIONS.has(value as VaultAutoLockMinutes)
    ? value as VaultAutoLockMinutes
    : DEFAULT_VAULT_AUTO_LOCK_MINUTES
}

export function createDefaultAppSettings(): AppSettings {
  return {
    mode: 'work',
    globalShortcut: 'Ctrl+Alt+Space',
    doubleClickAction: 'none',
    autostart: false,
    orbSize: 56,
    orbOpacity: 1,
    vaultAutoLockMinutes: DEFAULT_VAULT_AUTO_LOCK_MINUTES,
  }
}

export async function loadAppSettings(): Promise<AppSettings> {
  const defaults = createDefaultAppSettings()
  try {
    const saved = isTauriRuntime()
      ? await (await load('settings.json')).get<Partial<AppSettings>>(STORE_KEY)
      : JSON.parse(localStorage.getItem(BROWSER_KEY) ?? 'null') as Partial<AppSettings> | null
    if (!saved) return defaults
    return {
      ...defaults,
      ...saved,
      orbSize: Math.min(68, Math.max(48, saved.orbSize ?? defaults.orbSize)),
      orbOpacity: Math.min(1, Math.max(.6, saved.orbOpacity ?? defaults.orbOpacity)),
      vaultAutoLockMinutes: normalizeVaultAutoLockMinutes(saved.vaultAutoLockMinutes),
    }
  } catch {
    return defaults
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  if (!isTauriRuntime()) {
    localStorage.setItem(BROWSER_KEY, JSON.stringify(settings))
    return
  }
  const store = await load('settings.json')
  await store.set(STORE_KEY, settings)
  await store.save()
}

export async function clearAllSettings(): Promise<void> {
  if (!isTauriRuntime()) {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('petal-toolbox.') && !key.startsWith('petal-toolbox.vault')) {
        localStorage.removeItem(key)
      }
    }
    return
  }
  const store = await load('settings.json')
  await store.clear()
  await store.save()
}
