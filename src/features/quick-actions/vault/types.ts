export type VaultCopyField = 'username' | 'password'

export type VaultHistoryProtection = 'applied' | 'unsupported' | 'failed'

export interface VaultStatus {
  initialized: boolean
  unlocked: boolean
}

export interface VaultItem {
  id: string
  title: string
  username: string
  password: string
  note: string
  createdAt: number
  updatedAt: number
}

export interface VaultItemInput {
  title: string
  username: string
  password: string
  note: string
}

export interface VaultCopyReceipt {
  clearAfterSeconds: number
  historyProtection: VaultHistoryProtection
}

export type VaultUiStatus = 'loading' | 'uninitialized' | 'locked' | 'unlocked' | 'error'
