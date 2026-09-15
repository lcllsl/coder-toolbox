import { Channel, invoke } from '@tauri-apps/api/core'
import type { ConflictStrategy, FileMeta, FileMovePlan, FileOrganizeManifest, FileOrganizeProgress, FileOrganizeResult, FileTypeGroup, UndoResult } from '@/features/ai-office/smart-file-organizer/types'
import { isTauriRuntime } from './runtime'

export interface ScanOptions { recursive: boolean; fileTypes: FileTypeGroup[]; excludedNameKeywords: string[]; excludedDirectories: string[] }

export async function scanOrganizerDirectory(rootDirectory: string, options: ScanOptions): Promise<FileMeta[]> {
  if (!isTauriRuntime()) return []
  return invoke<FileMeta[]>('scan_organizer_directory', { rootDirectory, options })
}

export async function executeFileOrganize(rootDirectory: string, taskId: string, plans: FileMovePlan[], conflictStrategy: ConflictStrategy, onProgress: (value: FileOrganizeProgress) => void): Promise<FileOrganizeResult> {
  if (!isTauriRuntime()) throw new Error('organizer_native_runtime_required')
  const progress = new Channel<FileOrganizeProgress>()
  progress.onmessage = onProgress
  return invoke<FileOrganizeResult>('execute_file_organize', { rootDirectory, taskId, plans: plans.map((plan) => ({ fileId: plan.fileId, sourcePath: plan.sourcePath, targetSegments: plan.targetSegments })), conflictStrategy, progress })
}

export async function cancelFileOrganize(taskId: string): Promise<void> {
  if (isTauriRuntime()) await invoke('cancel_file_organize', { taskId })
}

export async function validateOrganizerPlan(rootDirectory: string, plans: FileMovePlan[]): Promise<string[]> {
  if (!isTauriRuntime()) return []
  return invoke<string[]>('validate_organizer_plan', {
    rootDirectory,
    plans: plans.map((plan) => ({ fileId: plan.fileId, sourcePath: plan.sourcePath, targetSegments: plan.targetSegments })),
  })
}

export async function undoFileOrganize(manifest: FileOrganizeManifest): Promise<UndoResult> {
  if (!isTauriRuntime()) throw new Error('organizer_native_runtime_required')
  return invoke<UndoResult>('undo_file_organize', { manifest })
}

export function organizerErrorMessage(error: unknown): string {
  const code = String(error)
  if (code.includes('organizer_too_many_files')) return '文件超过 5,000 个，请缩小整理范围后重试'
  if (code.includes('organizer_root')) return '所选目录不存在、不可读取或不是文件夹'
  if (code.includes('organizer_permission')) return '无法创建目录或移动文件，请检查当前目录权限'
  if (code.includes('organizer_path')) return '整理计划未通过根目录安全校验'
  return '文件整理操作失败，请检查文件占用和目录权限'
}
