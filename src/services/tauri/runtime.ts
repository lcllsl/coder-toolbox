import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

export type AppWindowLabel = 'orb-window' | 'panel-window'

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined
}

export function getAppWindowLabel(): AppWindowLabel {
  if (isTauriRuntime()) {
    const label = getCurrentWebviewWindow().label
    return label === 'panel-window' ? 'panel-window' : 'orb-window'
  }

  const previewWindow = new URLSearchParams(window.location.search).get('window')
  return previewWindow === 'panel' ? 'panel-window' : 'orb-window'
}
