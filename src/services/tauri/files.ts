import { invoke } from '@tauri-apps/api/core'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { open } from '@tauri-apps/plugin-dialog'

import type { DirectoryCreationResult, SystemDirectories, TemporaryTransferCopy } from '@/features/files/types'
import { isTauriRuntime } from './runtime'

export interface DirectoryStatus {
  exists: boolean
  isDirectory: boolean
}

export async function selectDirectory(title = '选择文件夹'): Promise<string | null> {
  if (!isTauriRuntime()) return null
  const selected = await open({ title, directory: true, multiple: false, recursive: false, canCreateDirectories: true, fileAccessMode: 'scoped' })
  return typeof selected === 'string' ? selected : null
}

export async function selectFiles(title = '选择文件'): Promise<string[]> {
  if (!isTauriRuntime()) return []
  const selected = await open({ title, directory: false, multiple: true, fileAccessMode: 'scoped' })
  if (!selected) return []
  return Array.isArray(selected) ? selected : [selected]
}

export async function onFileSystemDrop(listener: (paths: string[]) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined
  return getCurrentWebviewWindow().onDragDropEvent((event) => {
    if (event.payload.type === 'drop') listener(event.payload.paths)
  })
}

export async function getSystemDirectories(): Promise<SystemDirectories> {
  if (!isTauriRuntime()) return {
    desktop: '/Users/demo/Desktop',
    documents: '/Users/demo/Documents',
    downloads: '/Users/demo/Downloads',
  }
  return invoke<SystemDirectories>('system_directories')
}

export async function getDirectoryStatus(path: string): Promise<DirectoryStatus> {
  if (!isTauriRuntime()) return { exists: true, isDirectory: true }
  return invoke<DirectoryStatus>('directory_status', { path })
}

export async function openDirectory(path: string): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('open_directory', { path })
}

export async function createDateDirectory(parentPath: string, folderName: string): Promise<DirectoryCreationResult> {
  if (!isTauriRuntime()) return { path: `${parentPath}/${folderName}`, existed: false }
  return invoke<DirectoryCreationResult>('create_date_directory', { parentPath, folderName })
}

export async function copyToTemporaryTransfer(sourcePath: string, id: string): Promise<TemporaryTransferCopy> {
  if (!isTauriRuntime()) return { storedPath: sourcePath, kind: 'file', sizeBytes: 0 }
  return invoke<TemporaryTransferCopy>('copy_to_temporary_transfer', { sourcePath, id })
}

export async function deleteTemporaryTransferCopy(id: string): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('delete_temporary_transfer_copy', { id })
}

export async function openTemporaryTransferCopy(id: string): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('open_temporary_transfer_copy', { id })
}
