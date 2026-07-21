export type AppMode = 'work' | 'silent' | 'paused'
export type DoubleClickAction = 'none' | 'quick-actions' | 'clipboard' | 'dev-tools'

export interface AppSettings {
  mode: AppMode
  globalShortcut: string
  doubleClickAction: DoubleClickAction
  autostart: boolean
  orbSize: number
  orbOpacity: number
}
