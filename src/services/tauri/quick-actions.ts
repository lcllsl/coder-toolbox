import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

import { isTauriRuntime } from './runtime'

export interface ApplicationStatus {
  exists: boolean
  launchable: boolean
}

export async function selectApplication(): Promise<string | null> {
  if (!isTauriRuntime()) return null
  const selected = await open({ title: '选择常用应用', multiple: false, directory: false, fileAccessMode: 'scoped' })
  return typeof selected === 'string' ? selected : null
}

export async function getApplicationStatus(path: string): Promise<ApplicationStatus> {
  if (!isTauriRuntime()) return { exists: true, launchable: true }
  return invoke<ApplicationStatus>('application_status', { path })
}

export async function openApplication(path: string): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('open_application', { path })
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('open_external_url', { url })
}
