export interface FavoriteFolder {
  id: string
  name: string
  path: string
  sortOrder: number
  exists: boolean
  system?: boolean
}

export type DateFolderFormat = 'YYYY-MM-DD' | 'YYYYMMDD' | 'YYYY-MM-DD_topic'

export interface DirectoryCreationResult {
  path: string
  existed: boolean
}

export interface SystemDirectories {
  desktop?: string
  documents?: string
  downloads?: string
}

export interface TemporaryTransferItem {
  id: string
  name: string
  originalPath: string
  storedPath: string
  kind: 'file' | 'directory'
  sizeBytes: number
  addedAt: string
  expiresAt: string
  isPinned: boolean
}

export interface TemporaryTransferCopy {
  storedPath: string
  kind: TemporaryTransferItem['kind']
  sizeBytes: number
}
