import type { ColumnDefinition, ColumnKind, TabularDataset } from '../smart-chart/types'
import type { SmartTable, SmartTableColumnType, SmartTableRow, SmartTableSchema, SmartTableSourceBlock } from './types'

const KIND_MAP: Record<SmartTableColumnType, ColumnKind> = {
  text: 'text', number: 'number', currency: 'currency', percentage: 'percentage', date: 'date', datetime: 'datetime',
  boolean: 'boolean', category: 'category', phone: 'text', email: 'text', id: 'id',
}

function rowSignature(row: SmartTableRow, columnIds: string[]): string {
  return JSON.stringify(columnIds.map((id) => row.values[id]?.value ?? null))
}

export function removeDuplicateRows(rows: SmartTableRow[], columnIds: string[]): SmartTableRow[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const signature = rowSignature(row, columnIds)
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  })
}

export function removeEmptyRows(rows: SmartTableRow[], columnIds: string[]): SmartTableRow[] {
  return rows.filter((row) => columnIds.some((id) => {
    const value = row.values[id]?.value
    return value !== null && value !== undefined && value !== ''
  }))
}

export function rowNeedsReview(row: SmartTableRow): boolean {
  return !row.confirmed && (row.confidence === 'low' || row.warnings.length > 0 || Object.values(row.values).some((cell) => Boolean(cell.warning)))
}

export function createSmartTableResult(schema: SmartTableSchema, rows: readonly SmartTableRow[], sourceBlocks: readonly SmartTableSourceBlock[]): SmartTable {
  return {
    version: 1,
    title: schema.tableTitle,
    columns: schema.columns.map((column) => ({ ...column })),
    rows: rows.map((row) => ({
      ...row,
      sourceIds: [...row.sourceIds],
      warnings: [...row.warnings],
      values: Object.fromEntries(Object.entries(row.values).map(([id, cell]) => [id, { ...cell, sourceIds: cell.sourceIds ? [...cell.sourceIds] : undefined }])),
    })),
    sourceBlocks: sourceBlocks.map((block) => ({ ...block })),
  }
}

export function smartTableToDataset(table: SmartTable): TabularDataset {
  const columns: ColumnDefinition[] = table.columns.map((column, sourceIndex) => ({
    key: column.label, label: column.label, sourceIndex, kind: KIND_MAP[column.type], inferredKind: KIND_MAP[column.type], confidence: 1, sensitive: Boolean(column.sensitive),
  }))
  const rows = table.rows.map((row) => Object.fromEntries(table.columns.map((column) => [column.label, row.values[column.id]?.value ?? null])))
  return { fileName: `${table.title}.xlsx`, sheetName: table.title, headerRow: 0, columns, rows }
}
