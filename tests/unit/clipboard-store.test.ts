import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clipboard = vi.hoisted(() => ({
  getSequence: vi.fn<() => Promise<number | null>>(),
  readText: vi.fn<() => Promise<string | null>>(),
  readImage: vi.fn<() => Promise<null>>(),
  shouldIgnoreSensitive: vi.fn<(text: string, sequence: number) => Promise<boolean>>(),
  publishHistoryChanged: vi.fn<() => Promise<void>>(),
  saveImage: vi.fn<() => Promise<string>>(),
  deleteImage: vi.fn<(path: string) => Promise<void>>(),
}))

const repository = vi.hoisted(() => ({
  insertItem: vi.fn<(item: unknown) => Promise<void>>(),
  getLatestItem: vi.fn<() => Promise<null>>(),
  listItems: vi.fn<() => Promise<never[]>>(),
  pruneItems: vi.fn<() => Promise<string[]>>(),
}))

vi.mock('@/services/tauri/clipboard', () => ({
  deleteClipboardImage: clipboard.deleteImage,
  getClipboardSequenceNumber: clipboard.getSequence,
  publishClipboardHistoryChanged: clipboard.publishHistoryChanged,
  publishClipboardSettingsChanged: vi.fn(),
  readClipboardImage: clipboard.readImage,
  readClipboardText: clipboard.readText,
  saveClipboardImage: clipboard.saveImage,
  shouldIgnoreSensitiveClipboard: clipboard.shouldIgnoreSensitive,
  writeCachedClipboardImage: vi.fn(),
  writeClipboardText: vi.fn(),
}))

vi.mock('@/features/clipboard/repositories/clipboard-repository', () => ({
  cleanupClipboardItems: vi.fn(async () => []),
  clearAllClipboardItems: vi.fn(async () => []),
  clearUnprotectedClipboardItems: vi.fn(),
  deleteClipboardItems: vi.fn(),
  getLatestClipboardItem: repository.getLatestItem,
  insertClipboardItem: repository.insertItem,
  listClipboardItems: repository.listItems,
  markClipboardItemCopied: vi.fn(),
  pruneClipboardItems: repository.pruneItems,
  setClipboardItemFlag: vi.fn(),
  touchClipboardItem: vi.fn(),
}))

import { useClipboardStore } from '@/app/stores/clipboard'

describe('clipboard polling security boundary', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    clipboard.readImage.mockResolvedValue(null)
    clipboard.publishHistoryChanged.mockResolvedValue()
    clipboard.saveImage.mockResolvedValue('/cache/clipboard-image.png')
    clipboard.deleteImage.mockResolvedValue()
    repository.getLatestItem.mockResolvedValue(null)
    repository.listItems.mockResolvedValue([])
    repository.pruneItems.mockResolvedValue([])
    repository.insertItem.mockResolvedValue()
  })

  it('does not ingest a native-marked vault copy even when sensitive detection is disabled', async () => {
    clipboard.getSequence.mockResolvedValueOnce(101).mockResolvedValueOnce(101)
    clipboard.readText.mockResolvedValue('vault-user-101')
    clipboard.shouldIgnoreSensitive.mockResolvedValue(true)
    const store = useClipboardStore()
    store.settings.skipSensitive = false

    await store.poll()

    expect(clipboard.shouldIgnoreSensitive).toHaveBeenCalledWith('vault-user-101', 101)
    expect(repository.insertItem).not.toHaveBeenCalled()
  })

  it('drops a polling pass when the clipboard sequence changes while text is read', async () => {
    clipboard.getSequence.mockResolvedValueOnce(202).mockResolvedValueOnce(203)
    clipboard.readText.mockResolvedValue('changed-during-read')
    const store = useClipboardStore()
    store.settings.skipSensitive = false

    await store.poll()

    expect(clipboard.shouldIgnoreSensitive).not.toHaveBeenCalled()
    expect(repository.insertItem).not.toHaveBeenCalled()
  })

  it('ingests ordinary text only after a stable sequence is verified', async () => {
    clipboard.getSequence.mockResolvedValueOnce(304).mockResolvedValueOnce(304)
    clipboard.readText.mockResolvedValue('ordinary clipboard 304')
    clipboard.shouldIgnoreSensitive.mockResolvedValue(false)
    const store = useClipboardStore()
    store.settings.skipSensitive = false

    await store.poll()

    expect(repository.insertItem).toHaveBeenCalledOnce()
    expect(repository.insertItem.mock.calls[0]?.[0]).toMatchObject({
      textContent: 'ordinary clipboard 304',
    })
  })

  it('fails closed and retries when the native sensitive marker check fails', async () => {
    clipboard.getSequence.mockResolvedValue(405)
    clipboard.readText.mockResolvedValue('vault-copy-405')
    clipboard.shouldIgnoreSensitive
      .mockRejectedValueOnce(new Error('marker_unavailable'))
      .mockResolvedValueOnce(true)
    const store = useClipboardStore()
    store.settings.skipSensitive = false

    await expect(store.poll()).rejects.toThrow('marker_unavailable')
    expect(repository.insertItem).not.toHaveBeenCalled()
    await store.poll()

    expect(clipboard.shouldIgnoreSensitive).toHaveBeenCalledTimes(2)
    expect(repository.insertItem).not.toHaveBeenCalled()
  })

  it('retries the same stable clipboard value after repository persistence fails', async () => {
    clipboard.getSequence.mockResolvedValue(506)
    clipboard.readText.mockResolvedValue('retry clipboard 506')
    clipboard.shouldIgnoreSensitive.mockResolvedValue(false)
    repository.insertItem
      .mockRejectedValueOnce(new Error('database_write_failed'))
      .mockResolvedValueOnce(undefined)
    const store = useClipboardStore()
    store.settings.skipSensitive = false

    await expect(store.poll()).rejects.toThrow('database_write_failed')
    await store.poll()

    expect(repository.insertItem).toHaveBeenCalledTimes(2)
    expect(repository.insertItem.mock.calls[1]?.[0]).toMatchObject({
      textContent: 'retry clipboard 506',
    })
  })

  it('removes a newly cached image when its database insert fails', async () => {
    repository.insertItem.mockRejectedValueOnce(new Error('database_write_failed'))
    const store = useClipboardStore()
    const image = { rgba: new Uint8Array([10, 20, 30, 255]), width: 1, height: 1 }

    await expect(store.ingestImage(image)).rejects.toThrow('database_write_failed')

    expect(clipboard.saveImage).toHaveBeenCalledOnce()
    expect(clipboard.deleteImage).toHaveBeenCalledWith('/cache/clipboard-image.png')
  })
})
