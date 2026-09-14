export type AppMode = 'work' | 'silent' | 'paused'
export type DoubleClickAction = 'none' | 'quick-actions' | 'clipboard' | 'dev-tools'
export type VaultAutoLockMinutes = 1 | 5 | 15 | 30
export type AiModel = 'deepseek-v4-flash' | 'deepseek-v4-pro'

export interface AppSettings {
  mode: AppMode
  globalShortcut: string
  doubleClickAction: DoubleClickAction
  autostart: boolean
  orbSize: number
  orbOpacity: number
  vaultAutoLockMinutes: VaultAutoLockMinutes
  aiModel: AiModel
  aiPrivacyNoticeDismissed: boolean
  smartTablePrivacyNoticeDismissed: boolean
}
