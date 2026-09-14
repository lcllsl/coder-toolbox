import { z } from 'zod'

import { containsUnknownPrivacyToken, restorePrivacyTokens } from './privacy'
import type { PrivacyToken, SmartTableCell, SmartTableColumn, SmartTableConfidence, SmartTableRow, SmartTableSchema } from './types'

export const SMART_TABLE_COLUMN_TYPES = ['text', 'number', 'currency', 'percentage', 'date', 'datetime', 'boolean', 'category', 'phone', 'email', 'id'] as const
export const SMART_TABLE_COLUMN_LABELS: Record<(typeof SMART_TABLE_COLUMN_TYPES)[number], string> = {
  text: '文本', number: '数字', currency: '金额', percentage: '百分比', date: '日期', datetime: '日期时间',
  boolean: '布尔值', category: '分类', phone: '电话', email: '邮箱', id: '标识符',
}

const columnSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  label: z.string().trim().min(1).max(80),
  type: z.enum(SMART_TABLE_COLUMN_TYPES),
  description: z.string().trim().max(160).optional().default(''),
  sensitive: z.boolean().optional().default(false),
}).strict()

export const smartTableSchemaSchema = z.object({
  version: z.literal(1),
  tableTitle: z.string().trim().min(1).max(100),
  columns: z.array(columnSchema).min(1).max(12),
}).strict()

const extractionSchema = z.object({
  version: z.literal(1),
  rows: z.array(z.object({
    id: z.string().trim().min(1).max(100),
    values: z.record(z.string(), z.unknown()),
    sourceIds: z.array(z.string()),
    confidence: z.enum(['high', 'medium', 'low']).optional().default('high'),
    warnings: z.array(z.string().max(180)).optional().default([]),
  }).strict()).max(2_000),
}).strict()

export function parseSmartTableSchema(input: unknown): SmartTableSchema {
  const parsed = smartTableSchemaSchema.parse(input)
  if (new Set(parsed.columns.map((column) => column.id)).size !== parsed.columns.length) throw new Error('smart_table_duplicate_column_id')
  return parsed
}

function normalizeCellValue(value: unknown, column: SmartTableColumn): { cell: SmartTableCell; warning?: string } {
  if (value === null || value === undefined || value === '') return { cell: { value: null } }
  if (column.type === 'phone' || column.type === 'id' || column.type === 'email' || column.type === 'text' || column.type === 'category' || column.type === 'date' || column.type === 'datetime') {
    const stringValue = String(value)
    return { cell: { value: stringValue }, warning: typeof value === 'number' && ['phone', 'id'].includes(column.type) ? `${column.label}已按文本保留` : undefined }
  }
  if (column.type === 'boolean') {
    if (typeof value === 'boolean') return { cell: { value } }
    if (['是', 'true', '1'].includes(String(value).toLowerCase())) return { cell: { value: true } }
    if (['否', 'false', '0'].includes(String(value).toLowerCase())) return { cell: { value: false } }
    return { cell: { value: String(value) }, warning: `${column.label}无法确定为是或否` }
  }
  const number = typeof value === 'number' ? value : Number(String(value).replace(/[￥¥$€£,，\s]/g, '').replace(/%$/, ''))
  if (!Number.isFinite(number)) return { cell: { value: null }, warning: `${column.label}不是有效数值` }
  const normalized = column.type === 'percentage' && typeof value === 'string' && value.trim().endsWith('%') ? number / 100 : number
  return { cell: { value: normalized } }
}

export function parseExtractionResult(
  input: unknown,
  schema: SmartTableSchema,
  validSourceIds: ReadonlySet<string>,
  tokens: readonly PrivacyToken[],
): SmartTableRow[] {
  const parsed = extractionSchema.parse(input)
  const columns = new Map(schema.columns.map((column) => [column.id, column]))
  return parsed.rows.map((rawRow, rowIndex) => {
    const warnings = [...rawRow.warnings]
    const extraFields = Object.keys(rawRow.values).filter((id) => !columns.has(id))
    if (extraFields.length) warnings.push(`已忽略未定义字段：${extraFields.join('、')}`)
    const sourceIds = [...new Set(rawRow.sourceIds.filter((id) => validSourceIds.has(id)))]
    if (sourceIds.length !== rawRow.sourceIds.length) warnings.push('AI 返回了无效的原文来源')
    const values = Object.fromEntries(schema.columns.map((column) => {
      const normalized = normalizeCellValue(rawRow.values[column.id], column)
      if (normalized.warning) warnings.push(normalized.warning)
      if (containsUnknownPrivacyToken(normalized.cell.value, tokens)) warnings.push(`${column.label}包含未知隐私占位符`)
      if (typeof normalized.cell.value === 'string') {
        const restored = restorePrivacyTokens(normalized.cell.value, tokens)
        normalized.cell.value = restored.text
      }
      const warning = warnings.find((item) => item.startsWith(column.label))
      return [column.id, { ...normalized.cell, confidence: warning ? 'low' : rawRow.confidence, sourceIds, warning }]
    }))
    const confidence: SmartTableConfidence = warnings.length ? 'low' : rawRow.confidence
    return { id: rawRow.id || `row-${rowIndex + 1}`, values, sourceIds, confidence, warnings: [...new Set(warnings)] }
  })
}

export function smartTableValidationReason(error: unknown): string {
  const text = String(error)
  if (text.includes('duplicate_column')) return 'duplicate_column_id'
  return 'schema_invalid'
}
