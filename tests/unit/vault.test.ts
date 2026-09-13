import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  filterVaultItems,
  normalizeVaultItemInput,
  validateVaultInitialization,
  validateVaultItem,
} from '@/features/quick-actions/vault/core/validation'
import type { VaultItem } from '@/features/quick-actions/vault/types'

const vaultService = vi.hoisted(() => ({
  onVaultLocked: vi.fn(),
  vaultConfigureAutoLock: vi.fn(),
  vaultCopyItemField: vi.fn(),
  vaultCopyText: vi.fn(),
  vaultCreateItem: vi.fn(),
  vaultDeleteItem: vi.fn(),
  vaultInitialize: vi.fn(),
  vaultListItems: vi.fn(),
  vaultLock: vi.fn(),
  vaultReset: vi.fn(),
  vaultStatus: vi.fn(),
  vaultTouch: vi.fn(),
  vaultUnlock: vi.fn(),
  vaultUpdateItem: vi.fn(),
}))

vi.mock('@/services/tauri/vault', () => vaultService)

import { useVaultStore } from '@/app/stores/vault'

let vaultLockedHandler: (() => void) | undefined

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function item(id: string, title: string, username: string, password = 'fixed-secret'): VaultItem {
  return {
    id,
    title,
    username,
    password,
    note: '',
    createdAt: 1,
    updatedAt: 1,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  vaultLockedHandler = undefined
  vaultService.onVaultLocked.mockImplementation(async (handler: () => void) => {
    vaultLockedHandler = handler
    return () => undefined
  })
  vaultService.vaultConfigureAutoLock.mockResolvedValue(undefined)
  vaultService.vaultTouch.mockResolvedValue(undefined)
  vaultService.vaultLock.mockResolvedValue(undefined)
  vaultService.vaultReset.mockResolvedValue(undefined)
  vaultService.vaultInitialize.mockResolvedValue(undefined)
  vaultService.vaultUnlock.mockResolvedValue(undefined)
  vaultService.vaultDeleteItem.mockResolvedValue(undefined)
  vaultService.vaultListItems.mockResolvedValue([])
  vaultService.vaultStatus.mockResolvedValue({ initialized: true, unlocked: false })
  useVaultStore().applyLockedState(false)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('vault input rules', () => {
  it('validates initialization without imposing a complex password policy', () => {
    expect(validateVaultInitialization('', '')).toEqual({ error: '请输入主密码' })
    expect(validateVaultInitialization('first-value', 'second-value').error).toContain('不一致')
    expect(validateVaultInitialization('short', 'short').warning).toContain('较短')
    expect(validateVaultInitialization('long-enough', 'long-enough')).toEqual({})
  })

  it('requires only a title and password for a credential', () => {
    expect(validateVaultItem({ title: '  ', username: '', password: 'secret', note: '' }).error).toContain('系统名称')
    expect(validateVaultItem({ title: 'OA', username: '', password: '', note: '' }).error).toContain('密码')
    expect(validateVaultItem({ title: ' OA ', username: ' user ', password: ' secret ', note: ' note ' })).toEqual({})
    expect(normalizeVaultItemInput({ title: ' OA ', username: ' user ', password: ' secret ', note: ' note ' })).toEqual({
      title: 'OA',
      username: ' user ',
      password: ' secret ',
      note: ' note ',
    })
  })

  it('searches decrypted in-memory items by title and username only', () => {
    const items = [
      item('1', 'OA 管理后台', 'admin001'),
      item('2', '项目仓库', 'build-bot'),
    ]
    expect(filterVaultItems(items, '管理')).toEqual([items[0]])
    expect(filterVaultItems(items, 'BUILD')).toEqual([items[1]])
    expect(filterVaultItems(items, 'fixed-secret')).toEqual([])
  })
})

describe('vault store session state', () => {
  it('distinguishes first use and an initialized locked vault', async () => {
    vaultService.vaultStatus.mockResolvedValueOnce({ initialized: false, unlocked: false })
    const firstUse = useVaultStore()
    await firstUse.initialize(5)
    expect(firstUse.status).toBe('uninitialized')
    expect(firstUse.items).toEqual([])

    setActivePinia(createPinia())
    vaultService.vaultStatus.mockResolvedValueOnce({ initialized: true, unlocked: false })
    const locked = useVaultStore()
    await locked.initialize(5)
    expect(locked.status).toBe('locked')
    expect(locked.items).toEqual([])
  })

  it('keeps a wrong unlock locked and loads plaintext only after a correct unlock', async () => {
    const store = useVaultStore()
    store.status = 'locked'
    vaultService.vaultUnlock.mockRejectedValueOnce(new Error('invalid_password'))
    await expect(store.unlockVault('wrong-value')).rejects.toThrow('invalid_password')
    expect(store.status).toBe('locked')
    expect(store.items).toEqual([])

    const saved = item('1', 'OA 管理后台', 'admin001')
    vaultService.vaultListItems.mockResolvedValueOnce([saved])
    await store.unlockVault('correct-value')
    expect(store.status).toBe('unlocked')
    expect(store.items).toEqual([saved])
  })

  it('creates, updates and deletes credentials through the service boundary', async () => {
    const store = useVaultStore()
    store.status = 'unlocked'
    const created = item('created', 'OA', 'user001')
    const updated = { ...created, title: 'OA 生产' }
    vaultService.vaultCreateItem.mockResolvedValueOnce(created)
    vaultService.vaultUpdateItem.mockResolvedValueOnce(updated)

    await store.createItem({ title: ' OA ', username: 'user001', password: 'fixed-secret', note: '' })
    expect(vaultService.vaultCreateItem).toHaveBeenCalledWith({ title: 'OA', username: 'user001', password: 'fixed-secret', note: '' })
    expect(store.items).toEqual([created])

    await store.updateItem(created.id, { title: 'OA 生产', username: 'user001', password: 'fixed-secret', note: '' })
    expect(store.items).toEqual([updated])

    await store.deleteItem(created.id)
    expect(vaultService.vaultDeleteItem).toHaveBeenCalledWith(created.id)
    expect(store.items).toEqual([])
  })

  it('manually locks and removes decrypted state', async () => {
    const store = useVaultStore()
    store.status = 'unlocked'
    store.items = [item('1', 'OA', 'user001')]
    store.search = 'OA'

    await store.lockVault()

    expect(vaultService.vaultLock).toHaveBeenCalledOnce()
    expect(store.status).toBe('locked')
    expect(store.items).toEqual([])
    expect(store.search).toBe('')
    expect(store.lastActivityAt).toBeUndefined()
  })

  it('auto-locks after inactivity and search activity restarts the deadline', async () => {
    const store = useVaultStore()
    store.status = 'unlocked'
    store.autoLockMinutes = 1
    store.items = [item('1', 'OA', 'user001')]
    store.recordActivity(true)

    await vi.advanceTimersByTimeAsync(50_000)
    store.setSearch('OA')
    await vi.advanceTimersByTimeAsync(50_000)
    expect(store.status).toBe('unlocked')
    expect(store.items).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(vaultService.vaultLock).toHaveBeenCalledOnce()
    expect(store.status).toBe('locked')
    expect(store.items).toEqual([])
  })

  it('discards a credential response that completes after a lock event', async () => {
    const store = useVaultStore()
    store.status = 'unlocked'
    store.items = [item('existing', 'Existing', 'user')]
    await store.ensureLockListener()
    const pendingCreate = deferred<VaultItem>()
    vaultService.vaultCreateItem.mockReturnValueOnce(pendingCreate.promise)

    const request = store.createItem({
      title: 'Late item',
      username: 'late-user',
      password: 'late-secret',
      note: '',
    })
    vaultLockedHandler?.()
    pendingCreate.resolve(item('late', 'Late item', 'late-user'))

    await expect(request).rejects.toThrow('vault_locked')
    expect(store.status).toBe('locked')
    expect(store.items).toEqual([])
  })

  it('does not restore an unlock that completes after a lock event', async () => {
    const store = useVaultStore()
    store.status = 'locked'
    await store.ensureLockListener()
    const pendingUnlock = deferred<void>()
    vaultService.vaultUnlock.mockReturnValueOnce(pendingUnlock.promise)

    const request = store.unlockVault('correct-value')
    await vi.waitFor(() => expect(vaultService.vaultUnlock).toHaveBeenCalledOnce())
    vaultLockedHandler?.()
    pendingUnlock.resolve()

    await expect(request).rejects.toThrow('vault_locked')
    expect(vaultService.vaultListItems).not.toHaveBeenCalled()
    expect(store.status).toBe('locked')
    expect(store.items).toEqual([])
  })

  it('waits for an in-flight unlock before refreshing native status', async () => {
    const store = useVaultStore()
    store.status = 'locked'
    const saved = item('1', 'OA 管理后台', 'admin001')
    const pendingUnlock = deferred<void>()
    vaultService.vaultUnlock.mockReturnValueOnce(pendingUnlock.promise)
    vaultService.vaultListItems.mockResolvedValue([saved])
    vaultService.vaultStatus.mockResolvedValue({ initialized: true, unlocked: true })

    const authentication = store.unlockVault('correct-value')
    await vi.waitFor(() => expect(vaultService.vaultUnlock).toHaveBeenCalledOnce())
    const refresh = store.initialize(5)
    expect(vaultService.vaultStatus).not.toHaveBeenCalled()
    pendingUnlock.resolve()

    await Promise.all([authentication, refresh])
    expect(store.status).toBe('unlocked')
    expect(store.items).toEqual([saved])
    expect(vaultService.vaultLock).not.toHaveBeenCalled()
  })

  it('does not overwrite a newer unlocked state when refresh cleanup finishes late', async () => {
    const store = useVaultStore()
    vaultService.vaultStatus.mockRejectedValueOnce(new Error('vault_database_read_failed'))
    const pendingLock = deferred<void>()
    vaultService.vaultLock.mockReturnValueOnce(pendingLock.promise)

    const refresh = store.initialize(5)
    await vi.waitFor(() => expect(vaultService.vaultLock).toHaveBeenCalledOnce())
    const saved = item('new-session', 'New session', 'new-user')
    store.activateUnlocked([saved])
    pendingLock.resolve()

    await refresh
    expect(store.status).toBe('unlocked')
    expect(store.items).toEqual([saved])
  })

  it('reconciles metadata committed by an initialization interrupted by a lock', async () => {
    const store = useVaultStore()
    store.status = 'uninitialized'
    await store.ensureLockListener()
    const pendingInitialization = deferred<void>()
    vaultService.vaultInitialize.mockReturnValueOnce(pendingInitialization.promise)

    const request = store.initializeVault('new-master-password')
    await vi.waitFor(() => expect(vaultService.vaultInitialize).toHaveBeenCalledOnce())
    vaultLockedHandler?.()
    pendingInitialization.reject(new Error('vault_locked'))

    await expect(request).rejects.toThrow('vault_locked')
    expect(vaultService.vaultStatus).toHaveBeenCalled()
    expect(store.status).toBe('locked')
    expect(store.items).toEqual([])
  })

  it('fails closed when resetting the encrypted database fails', async () => {
    const store = useVaultStore()
    store.status = 'unlocked'
    store.items = [item('1', 'OA', 'user001')]
    vaultService.vaultReset.mockRejectedValueOnce(new Error('vault_database_write_failed'))

    await expect(store.resetVault()).rejects.toThrow('vault_database_write_failed')
    expect(store.status).toBe('locked')
    expect(store.items).toEqual([])
  })

  it('does not unlock when the native lock listener cannot be registered', async () => {
    const store = useVaultStore()
    store.status = 'locked'
    store.lockListenerReady = false
    vaultService.onVaultLocked.mockRejectedValueOnce(new Error('listener_failed'))

    await expect(store.unlockVault('correct-value')).rejects.toThrow('listener_failed')
    expect(vaultService.vaultUnlock).not.toHaveBeenCalled()
    expect(store.items).toEqual([])
  })
})
