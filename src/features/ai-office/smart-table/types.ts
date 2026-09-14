export type SmartTableColumnType =
  | 'text'
  | 'number'
  | 'currency'
  | 'percentage'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'category'
  | 'phone'
  | 'email'
  | 'id'

export type SmartTableConfidence = 'high' | 'medium' | 'low'
export type SmartTableTemplateId = 'auto' | 'people' | 'tasks' | 'expenses' | 'devices' | 'registration'

export interface SmartTableColumn {
  id: string
  label: string
  type: SmartTableColumnType
  description?: string
  sensitive?: boolean
}

export interface SmartTableSchema {
  version: 1
  tableTitle: string
  columns: SmartTableColumn[]
}

export interface SmartTableSourceBlock {
  id: string
  text: string
  startOffset: number
  endOffset: number
}

export interface SmartTableCell {
  value: string | number | boolean | null
  confidence?: SmartTableConfidence
  sourceIds?: string[]
  warning?: string
}

export interface SmartTableRow {
  id: string
  values: Record<string, SmartTableCell>
  sourceIds: string[]
  confidence: SmartTableConfidence
  warnings: string[]
  confirmed?: boolean
}

export interface SmartTable {
  version: 1
  title: string
  columns: SmartTableColumn[]
  rows: SmartTableRow[]
  sourceBlocks: SmartTableSourceBlock[]
}

export interface PrivacyToken {
  token: string
  originalValue: string
  type: string
}

export interface ProtectedText {
  text: string
  tokens: PrivacyToken[]
}

export interface SmartTableTemplate {
  id: SmartTableTemplateId
  label: string
  columns: Omit<SmartTableColumn, 'id'>[]
}

export interface SmartTableBatch {
  index: number
  sourceBlocks: SmartTableSourceBlock[]
}
