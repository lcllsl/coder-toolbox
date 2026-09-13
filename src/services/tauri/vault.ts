import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type {
  VaultCopyField,
  VaultCopyReceipt,
  VaultItem,
  VaultItemInput,
  VaultStatus,
} from '@/features/quick-actions/vault/types'
import { isTauriRuntime } from './runtime'

const VAULT_LOCKED_EVENT = 'vault:locked'

interface VaultPasswordRequest {
  masterPassword: string
  autoLockSeconds: number
}

interface VaultCopyTextRequest {
  text: string
  field: VaultCopyField
}

/*
 * Browser previews do not exercise production cryptography. This module-scoped mock exists only
 * for component previews and browser interaction tests; it never writes vault state to web storage.
 */
let previewInitialized = false
let previewUnlocked = false
let previewMasterPasswordDigest = ''
let previewMasterSalt = ''
let previewItems: VaultItem[] = []

function autoLockSeconds(minutes: number): number {
  return Math.max(1, Math.round(minutes * 60))
}

function cloneItem(item: VaultItem): VaultItem {
  return { ...item }
}

function requirePreviewUnlocked(): void {
  if (!previewInitialized || !previewUnlocked) throw new Error('vault_locked')
}

function dispatchPreviewLocked(): void {
  window.dispatchEvent(new Event(VAULT_LOCKED_EVENT))
}

async function previewDigest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function createPreviewSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function writePreviewClipboard(
  text: string,
  field: VaultCopyField,
): Promise<VaultCopyReceipt> {
  const expectedDigest = await previewDigest(text)
  await navigator.clipboard.writeText(text)
  const clearAfterSeconds = field === 'password' ? 15 : 30
  window.setTimeout(async () => {
    try {
      const current = await navigator.clipboard.readText()
      if (await previewDigest(current) === expectedDigest) await navigator.clipboard.writeText('')
    } catch {
      // Clipboard access can be revoked while a browser preview remains open.
    }
  }, clearAfterSeconds * 1_000)
  return { clearAfterSeconds, historyProtection: 'unsupported' }
}

export async function vaultStatus(): Promise<VaultStatus> {
  if (isTauriRuntime()) return invoke<VaultStatus>('vault_status')
  return { initialized: previewInitialized, unlocked: previewUnlocked }
}

export async function vaultInitialize(masterPassword: string, autoLockMinutes: number): Promise<void> {
  const request: VaultPasswordRequest = {
    masterPassword,
    autoLockSeconds: autoLockSeconds(autoLockMinutes),
  }
  if (isTauriRuntime()) {
    await invoke('vault_initialize', { request })
    return
  }
  if (previewInitialized) throw new Error('vault_already_initialized')
  previewMasterSalt = createPreviewSalt()
  previewMasterPasswordDigest = await previewDigest(`${previewMasterSalt}\0${masterPassword}`)
  previewInitialized = true
  previewUnlocked = true
  previewItems = []
}

export async function vaultUnlock(masterPassword: string, autoLockMinutes: number): Promise<void> {
  const request: VaultPasswordRequest = {
    masterPassword,
    autoLockSeconds: autoLockSeconds(autoLockMinutes),
  }
  if (isTauriRuntime()) {
    await invoke('vault_unlock', { request })
    return
  }
  const candidateDigest = await previewDigest(`${previewMasterSalt}\0${masterPassword}`)
  if (!previewInitialized || previewMasterPasswordDigest !== candidateDigest) {
    throw new Error('vault_invalid_master_password')
  }
  previewUnlocked = true
}

export async function vaultListItems(): Promise<VaultItem[]> {
  if (isTauriRuntime()) return invoke<VaultItem[]>('vault_list_items')
  requirePreviewUnlocked()
  return previewItems.map(cloneItem)
}

export async function vaultCreateItem(input: VaultItemInput): Promise<VaultItem> {
  if (isTauriRuntime()) return invoke<VaultItem>('vault_create_item', { request: input })
  requirePreviewUnlocked()
  const now = Date.now()
  const item: VaultItem = {
    id: crypto.randomUUID(),
    ...input,
    createdAt: now,
    updatedAt: now,
  }
  previewItems = [item, ...previewItems]
  return cloneItem(item)
}

export async function vaultUpdateItem(id: string, input: VaultItemInput): Promise<VaultItem> {
  if (isTauriRuntime()) return invoke<VaultItem>('vault_update_item', { id, request: input })
  requirePreviewUnlocked()
  const existing = previewItems.find((item) => item.id === id)
  if (!existing) throw new Error('vault_item_not_found')
  const updated = { ...existing, ...input, updatedAt: Date.now() }
  previewItems = previewItems.map((item) => item.id === id ? updated : item)
  return cloneItem(updated)
}

export async function vaultDeleteItem(id: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke('vault_delete_item', { id })
    return
  }
  requirePreviewUnlocked()
  previewItems = previewItems.filter((item) => item.id !== id)
}

export async function vaultLock(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke('vault_lock')
    return
  }
  previewUnlocked = false
  dispatchPreviewLocked()
}

export async function vaultTouch(autoLockMinutes: number): Promise<void> {
  if (isTauriRuntime()) {
    await invoke('vault_touch', { autoLockSeconds: autoLockSeconds(autoLockMinutes) })
    return
  }
  requirePreviewUnlocked()
}

export async function vaultReset(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke('vault_reset')
    return
  }
  previewInitialized = false
  previewUnlocked = false
  previewMasterPasswordDigest = ''
  previewMasterSalt = ''
  previewItems = []
  dispatchPreviewLocked()
}

export async function vaultCopyItemField(
  id: string,
  field: VaultCopyField,
): Promise<VaultCopyReceipt> {
  if (isTauriRuntime()) {
    return invoke<VaultCopyReceipt>('vault_copy_item_field', { id, field })
  }
  requirePreviewUnlocked()
  const item = previewItems.find((value) => value.id === id)
  if (!item) throw new Error('vault_item_not_found')
  return writePreviewClipboard(item[field], field)
}

export async function vaultCopyText(
  text: string,
  field: VaultCopyField,
): Promise<VaultCopyReceipt> {
  const request: VaultCopyTextRequest = { text, field }
  if (isTauriRuntime()) {
    return invoke<VaultCopyReceipt>('vault_copy_text', { request })
  }
  requirePreviewUnlocked()
  return writePreviewClipboard(text, field)
}

export async function vaultConfigureAutoLock(autoLockMinutes: number): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('vault_configure_auto_lock', {
    autoLockSeconds: autoLockSeconds(autoLockMinutes),
  })
}

export async function onVaultLocked(handler: () => void): Promise<UnlistenFn> {
  if (isTauriRuntime()) return listen(VAULT_LOCKED_EVENT, handler)
  window.addEventListener(VAULT_LOCKED_EVENT, handler)
  return () => window.removeEventListener(VAULT_LOCKED_EVENT, handler)
}
