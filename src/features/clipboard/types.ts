export const CLIPBOARD_TYPES = [
  'plain_text',
  'url',
  'json',
  'code',
  'image',
  'color',
  'email',
  'unknown',
] as const

export type ClipboardContentType = (typeof CLIPBOARD_TYPES)[number]

export interface ClipboardItem {
  id: string
  type: ClipboardContentType
  textContent?: string
  imagePath?: string
  contentHash: string
  previewText?: string
  createdAt: string
  updatedAt: string
  lastCopiedAt: string
  copyCount: number
  isFavorite: boolean
  isPinned: boolean
  isSensitive: boolean
  expiresAt?: string
}

export interface ClipboardSettings {
  paused: boolean
  skipSensitive: boolean
  textRetentionDays: number
  imageRetentionDays: number
  maxTextItems: number
  maxImageItems: number
}

export interface ClipboardQuery {
  search?: string
  type?: ClipboardContentType | 'all'
  favoritesOnly?: boolean
}
