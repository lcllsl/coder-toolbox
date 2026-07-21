import type { PanelCategory } from '@/types/navigation'

export type QuickCopyAction = 'date' | 'time' | 'datetime' | 'timestamp-seconds' | 'timestamp-milliseconds' | 'uuid'

export interface QuickLink {
  id: string
  type: 'url' | 'application'
  name: string
  target: string
  accent: string
  sortOrder: number
  enabled: boolean
}

export interface RecentFeature {
  id: string
  label: string
  category: PanelCategory
  usedAt: string
  useCount: number
}
