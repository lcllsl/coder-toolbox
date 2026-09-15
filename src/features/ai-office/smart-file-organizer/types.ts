export type FileScanScope = 'current' | 'recursive'
export type FileTypeGroup = 'word' | 'excel' | 'powerpoint' | 'pdf' | 'text' | 'other'
export type TimeSource = 'createdAt' | 'modifiedAt'
export type ConflictStrategy = 'rename' | 'skip' | 'confirm'
export type Confidence = 'high' | 'medium' | 'low'

export interface FileMeta {
  id: string
  name: string
  extension: string
  absolutePath: string
  parentFolderName: string
  relativeParent: string
  createdAt?: string | number
  modifiedAt?: string | number
  size: number
}

export interface FileAiMeta {
  id: string
  name: string
  extension: string
  parentFolder?: string
  createdAt?: string | number
  modifiedAt?: string | number
  size?: number
}

export type FileOrganizeRuleType = 'year' | 'quarter' | 'month' | 'day' | 'fileType' | 'department' | 'person' | 'project' | 'documentType' | 'topic'

export interface FileOrganizeRule {
  id: string
  type: FileOrganizeRuleType
  source?: TimeSource
  aiRequired: boolean
  enabled: boolean
  order: number
}

export type AiDimension = Extract<FileOrganizeRuleType, 'department' | 'person' | 'project' | 'documentType' | 'topic'>
export type ClassificationDictionary = Partial<Record<AiDimension, string[]>>

export interface AiFileClassificationItem {
  fileId: string
  categories: Partial<Record<AiDimension, string | null>>
  confidence: Confidence
  reason?: string
}

export interface FileMovePlan {
  fileId: string
  sourcePath: string
  fileName: string
  currentDirectory: string
  targetSegments: string[]
  classification: Partial<Record<AiDimension, string | null>>
  confidence?: Confidence
  reason?: string
  selected: boolean
  status: 'ready' | 'needs_confirmation' | 'unchanged' | 'conflict' | 'excluded'
}

export interface FileMoveRecord { fileId: string; from: string; to: string }
export interface FileOrganizeManifest { taskId: string; createdAt: string; rootDirectory: string; moves: FileMoveRecord[]; createdDirectories: string[] }
export interface FileOrganizeFailure { fileId: string; fileName: string; code: string }
export interface FileOrganizeResult { manifest: FileOrganizeManifest; moved: number; skipped: number; failed: FileOrganizeFailure[]; cancelled: boolean }
export interface FileOrganizeProgress { completed: number; total: number; currentFile: string; moved: number; skipped: number; failed: number }
export interface UndoResult { restored: number; conflicts: FileOrganizeFailure[]; failed: FileOrganizeFailure[] }
