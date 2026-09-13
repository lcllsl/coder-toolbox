import { defineStore } from 'pinia'

import { filterVaultItems, normalizeVaultItemInput } from '@/features/quick-actions/vault/core/validation'
import type {
  VaultCopyField,
  VaultCopyReceipt,
  VaultItem,
  VaultItemInput,
  VaultUiStatus,
} from '@/features/quick-actions/vault/types'
import {
  onVaultLocked,
  vaultConfigureAutoLock,
  vaultCopyItemField,
  vaultCopyText,
  vaultCreateItem,
  vaultDeleteItem,
  vaultInitialize,
  vaultListItems,
  vaultLock,
  vaultReset,
  vaultStatus,
  vaultTouch,
  vaultUnlock,
  vaultUpdateItem,
} from '@/services/tauri/vault'

const DEFAULT_AUTO_LOCK_MINUTES = 5
const ALLOWED_AUTO_LOCK_MINUTES = new Set([1, 5, 15, 30])
const TOUCH_THROTTLE_MS = 5_000

let autoLockTimer: number | undefined
let nativeTouchTimer: number | undefined
let lastNativeTouchAt = 0
let sessionEpoch = 0
let reconciliationRevision = 0
let lockListenerPromise: Promise<void> | undefined
let activeAuthentication: Promise<void> | undefined

function normalizedAutoLockMinutes(value: number): number {
  return ALLOWED_AUTO_LOCK_MINUTES.has(value) ? value : DEFAULT_AUTO_LOCK_MINUTES
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isVaultLockedError(error: unknown): boolean {
  return /(?:^|\W)vault_locked(?:\W|$)/i.test(errorCode(error))
}

function staleSessionError(): Error {
  return new Error('vault_locked')
}

export const useVaultStore = defineStore('vault', {
  state: () => ({
    status: 'loading' as VaultUiStatus,
    items: [] as VaultItem[],
    search: '',
    autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
    lastActivityAt: undefined as number | undefined,
    lockRevision: 0,
    lockListenerReady: false,
  }),
  getters: {
    filteredItems: (state): VaultItem[] => filterVaultItems(state.items, state.search),
    isUnlocked: (state): boolean => state.status === 'unlocked',
  },
  actions: {
    clearAutoLockTimer() {
      if (autoLockTimer !== undefined) window.clearTimeout(autoLockTimer)
      autoLockTimer = undefined
    },
    clearNativeTouchTimer() {
      if (nativeTouchTimer !== undefined) window.clearTimeout(nativeTouchTimer)
      nativeTouchTimer = undefined
    },
    applyLockedState(initialized = true) {
      sessionEpoch += 1
      this.clearAutoLockTimer()
      this.clearNativeTouchTimer()
      this.items = []
      this.search = ''
      this.lastActivityAt = undefined
      lastNativeTouchAt = 0
      this.lockRevision += 1
      this.status = initialized ? 'locked' : 'uninitialized'
    },
    activateUnlocked(items: VaultItem[]) {
      sessionEpoch += 1
      this.items = items
      this.search = ''
      this.status = 'unlocked'
      this.recordActivity(true)
    },
    async reconcileLockedStatus(expectedEpoch = sessionEpoch) {
      const requestRevision = ++reconciliationRevision
      try {
        const current = await vaultStatus()
        if (
          requestRevision !== reconciliationRevision
          || expectedEpoch !== sessionEpoch
          || this.isUnlocked
        ) return
        if (current.unlocked) {
          await vaultLock().catch(() => undefined)
          return
        }
        this.status = current.initialized ? 'locked' : 'uninitialized'
      } catch {
        if (
          requestRevision === reconciliationRevision
          && expectedEpoch === sessionEpoch
          && !this.isUnlocked
        ) this.status = 'locked'
      }
    },
    async ensureLockListener() {
      if (this.lockListenerReady) return
      if (!lockListenerPromise) {
        lockListenerPromise = onVaultLocked(() => {
          this.applyLockedState(true)
          const lockEpoch = sessionEpoch
          void this.reconcileLockedStatus(lockEpoch)
        })
          .then(() => { this.lockListenerReady = true })
          .finally(() => { lockListenerPromise = undefined })
      }
      await lockListenerPromise
    },
    scheduleAutoLock() {
      this.clearAutoLockTimer()
      if (!this.isUnlocked) return
      autoLockTimer = window.setTimeout(() => {
        void this.lockVault().catch(() => undefined)
      }, this.autoLockMinutes * 60_000)
    },
    recordActivity(forceNativeTouch = false) {
      if (!this.isUnlocked) return
      const now = Date.now()
      const operationEpoch = sessionEpoch
      this.lastActivityAt = now
      this.scheduleAutoLock()
      const sendTouch = () => {
        if (operationEpoch !== sessionEpoch || !this.isUnlocked) return
        lastNativeTouchAt = Date.now()
        void vaultTouch(this.autoLockMinutes).catch((error: unknown) => {
          if (operationEpoch !== sessionEpoch) return
          if (isVaultLockedError(error)) this.applyLockedState(true)
          else lastNativeTouchAt = 0
        })
      }
      const elapsed = now - lastNativeTouchAt
      if (forceNativeTouch || lastNativeTouchAt === 0 || elapsed >= TOUCH_THROTTLE_MS) {
        this.clearNativeTouchTimer()
        sendTouch()
        return
      }
      if (nativeTouchTimer !== undefined) return
      nativeTouchTimer = window.setTimeout(() => {
        nativeTouchTimer = undefined
        sendTouch()
      }, TOUCH_THROTTLE_MS - elapsed)
    },
    async initialize(autoLockMinutes = this.autoLockMinutes) {
      const pendingAuthentication = activeAuthentication
      if (pendingAuthentication) await pendingAuthentication.catch(() => undefined)
      this.autoLockMinutes = normalizedAutoLockMinutes(autoLockMinutes)
      sessionEpoch += 1
      const operationEpoch = sessionEpoch
      this.clearAutoLockTimer()
      this.clearNativeTouchTimer()
      this.items = []
      this.search = ''
      this.status = 'loading'
      try {
        await this.ensureLockListener()
        await vaultConfigureAutoLock(this.autoLockMinutes)
        const current = await vaultStatus()
        if (operationEpoch !== sessionEpoch) return
        if (!current.initialized) {
          this.applyLockedState(false)
          return
        }
        if (!current.unlocked) {
          this.applyLockedState(true)
          return
        }
        const items = await vaultListItems()
        if (operationEpoch !== sessionEpoch) return
        this.activateUnlocked(items)
      } catch {
        if (operationEpoch !== sessionEpoch) return
        this.applyLockedState(true)
        this.status = 'error'
        await vaultLock().catch(() => undefined)
      }
    },
    async initializeVault(masterPassword: string) {
      if (activeAuthentication) throw new Error('vault_authentication_in_progress')
      const authentication = (async () => {
        await this.ensureLockListener()
        const operationEpoch = sessionEpoch
        let nativeInitializationCompleted = false
        try {
          await vaultInitialize(masterPassword, this.autoLockMinutes)
          nativeInitializationCompleted = true
          if (operationEpoch !== sessionEpoch) throw staleSessionError()
          const items = await vaultListItems()
          if (operationEpoch !== sessionEpoch) throw staleSessionError()
          this.activateUnlocked(items)
        } catch (error) {
          if (nativeInitializationCompleted && operationEpoch !== sessionEpoch) {
            await vaultLock().catch(() => undefined)
          }
          if (operationEpoch !== sessionEpoch || isVaultLockedError(error)) {
            if (operationEpoch === sessionEpoch) this.applyLockedState(true)
            const lockEpoch = sessionEpoch
            await this.reconcileLockedStatus(lockEpoch)
          } else if (nativeInitializationCompleted && operationEpoch === sessionEpoch) {
            await vaultLock().catch(() => undefined)
            this.applyLockedState(true)
          }
          throw error
        }
      })()
      activeAuthentication = authentication
      try {
        await authentication
      } finally {
        if (activeAuthentication === authentication) activeAuthentication = undefined
      }
    },
    async unlockVault(masterPassword: string) {
      if (activeAuthentication) throw new Error('vault_authentication_in_progress')
      const authentication = (async () => {
        await this.ensureLockListener()
        const operationEpoch = sessionEpoch
        let nativeUnlockCompleted = false
        try {
          await vaultUnlock(masterPassword, this.autoLockMinutes)
          nativeUnlockCompleted = true
          if (operationEpoch !== sessionEpoch) throw staleSessionError()
          const items = await vaultListItems()
          if (operationEpoch !== sessionEpoch) throw staleSessionError()
          this.activateUnlocked(items)
        } catch (error) {
          if (nativeUnlockCompleted) {
            await vaultLock().catch(() => undefined)
            if (operationEpoch === sessionEpoch) this.applyLockedState(true)
          } else if (operationEpoch === sessionEpoch && isVaultLockedError(error)) {
            this.applyLockedState(true)
          }
          throw error
        }
      })()
      activeAuthentication = authentication
      try {
        await authentication
      } finally {
        if (activeAuthentication === authentication) activeAuthentication = undefined
      }
    },
    async lockVault() {
      try {
        await vaultLock()
      } finally {
        this.applyLockedState(true)
      }
    },
    async resetVault() {
      try {
        await vaultReset()
        this.applyLockedState(false)
      } catch (error) {
        this.applyLockedState(true)
        throw error
      }
    },
    async configureAutoLock(autoLockMinutes: number) {
      const normalized = normalizedAutoLockMinutes(autoLockMinutes)
      await vaultConfigureAutoLock(normalized)
      this.autoLockMinutes = normalized
      if (this.isUnlocked) this.recordActivity(true)
    },
    setSearch(search: string) {
      this.search = search
      this.recordActivity()
    },
    async createItem(input: VaultItemInput) {
      const operationEpoch = sessionEpoch
      try {
        const item = await vaultCreateItem(normalizeVaultItemInput(input))
        if (operationEpoch !== sessionEpoch || !this.isUnlocked) throw staleSessionError()
        this.items = [item, ...this.items.filter((value) => value.id !== item.id)]
        this.recordActivity(true)
        return item
      } catch (error) {
        if (operationEpoch === sessionEpoch && isVaultLockedError(error)) this.applyLockedState(true)
        throw error
      }
    },
    async updateItem(id: string, input: VaultItemInput) {
      const operationEpoch = sessionEpoch
      try {
        const item = await vaultUpdateItem(id, normalizeVaultItemInput(input))
        if (operationEpoch !== sessionEpoch || !this.isUnlocked) throw staleSessionError()
        this.items = this.items.map((value) => value.id === id ? item : value)
        this.recordActivity(true)
        return item
      } catch (error) {
        if (operationEpoch === sessionEpoch && isVaultLockedError(error)) this.applyLockedState(true)
        throw error
      }
    },
    async deleteItem(id: string) {
      const operationEpoch = sessionEpoch
      try {
        await vaultDeleteItem(id)
        if (operationEpoch !== sessionEpoch || !this.isUnlocked) throw staleSessionError()
        this.items = this.items.filter((item) => item.id !== id)
        this.recordActivity(true)
      } catch (error) {
        if (operationEpoch === sessionEpoch && isVaultLockedError(error)) this.applyLockedState(true)
        throw error
      }
    },
    async copyItemField(id: string, field: VaultCopyField): Promise<VaultCopyReceipt> {
      const operationEpoch = sessionEpoch
      try {
        const receipt = await vaultCopyItemField(id, field)
        if (operationEpoch !== sessionEpoch || !this.isUnlocked) throw staleSessionError()
        this.recordActivity(true)
        return receipt
      } catch (error) {
        if (operationEpoch === sessionEpoch && isVaultLockedError(error)) this.applyLockedState(true)
        throw error
      }
    },
    async copyText(text: string, field: VaultCopyField): Promise<VaultCopyReceipt> {
      const operationEpoch = sessionEpoch
      try {
        const receipt = await vaultCopyText(text, field)
        if (operationEpoch !== sessionEpoch || !this.isUnlocked) throw staleSessionError()
        this.recordActivity(true)
        return receipt
      } catch (error) {
        if (operationEpoch === sessionEpoch && isVaultLockedError(error)) this.applyLockedState(true)
        throw error
      }
    },
  },
})
