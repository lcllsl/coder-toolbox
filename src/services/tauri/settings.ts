import { invoke } from '@tauri-apps/api/core'
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'

import type { AppMode } from '@/features/settings/types'
import { isTauriRuntime } from './runtime'

const SETTINGS_CHANGED_EVENT = 'app:settings-changed'
const TRAY_MODE_EVENT = 'app:mode-requested'
const GLOBAL_SHORTCUT_EVENT = 'orb:global-shortcut'

export async function setAutostart(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return
  if (enabled) await enable()
  else await disable()
}

export async function getAutostartEnabled(): Promise<boolean> {
  if (!isTauriRuntime()) return false
  return isEnabled()
}

export async function replaceGlobalShortcut(nextShortcut: string, previousShortcut: string): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('replace_global_shortcut', { nextShortcut, previousShortcut })
}

export async function updateTrayMode(mode: AppMode): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('set_tray_mode', { mode })
}

export async function exitApplication(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('exit_application')
}

export async function publishAppSettingsChanged(): Promise<void> {
  if (!isTauriRuntime()) return
  await Promise.all([
    emitTo('orb-window', SETTINGS_CHANGED_EVENT),
    emitTo('panel-window', SETTINGS_CHANGED_EVENT),
  ])
}

export async function onAppSettingsChanged(handler: () => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined
  return listen(SETTINGS_CHANGED_EVENT, handler)
}

export async function onTrayModeRequested(handler: (mode: AppMode) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined
  return listen<{ mode: AppMode }>(TRAY_MODE_EVENT, (event) => handler(event.payload.mode))
}

export async function onGlobalShortcut(handler: () => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined
  return listen(GLOBAL_SHORTCUT_EVENT, handler)
}
