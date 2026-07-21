import { invoke } from '@tauri-apps/api/core'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { ReminderId } from '@/features/health/types'
import { isTauriRuntime } from './runtime'

const HEALTH_SETTINGS_CHANGED = 'health:settings-changed'
const HEALTH_DEBUG_TRIGGER = 'health:debug-trigger'

export async function publishHealthSettingsChanged(): Promise<void> {
  if (isTauriRuntime()) await emit(HEALTH_SETTINGS_CHANGED)
  else window.dispatchEvent(new Event(HEALTH_SETTINGS_CHANGED))
}

export async function onHealthSettingsChanged(handler: () => void): Promise<UnlistenFn> {
  if (isTauriRuntime()) return listen(HEALTH_SETTINGS_CHANGED, handler)
  window.addEventListener(HEALTH_SETTINGS_CHANGED, handler)
  return () => window.removeEventListener(HEALTH_SETTINGS_CHANGED, handler)
}

export async function triggerHealthDebugReminder(reminderId: ReminderId): Promise<void> {
  if (isTauriRuntime()) {
    await invoke('trigger_health_debug_reminder', { reminderId })
    return
  }
  window.dispatchEvent(new CustomEvent('panel:preview-close', { detail: { reopenPetals: false } }))
  window.dispatchEvent(new CustomEvent(HEALTH_DEBUG_TRIGGER, { detail: { reminderId } }))
}

export async function onHealthDebugTrigger(handler: (reminderId: ReminderId) => void): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<{ reminderId: ReminderId }>(HEALTH_DEBUG_TRIGGER, (event) => handler(event.payload.reminderId))
  }
  const listener = (event: Event) => handler((event as CustomEvent<{ reminderId: ReminderId }>).detail.reminderId)
  window.addEventListener(HEALTH_DEBUG_TRIGGER, listener)
  return () => window.removeEventListener(HEALTH_DEBUG_TRIGGER, listener)
}
