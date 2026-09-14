import * as XLSX from 'xlsx'

import type { SmartTable, SmartTableColumn, SmartTableColumnType } from './types'

const FORMULA_PREFIX = /^[=+\-@]/

export function safeExportName(title: string, extension: 'xlsx' | 'csv'): string {
  const base = title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80) || '智能表格'
  return `${base}_整理结果.${extension}`
}

export function protectFormulaText(value: string): string {
  return FORMULA_PREFIX.test(value.trimStart()) ? `'${value}` : value
}

function csvCell(value: unknown): string {
  const safe = typeof value === 'string' ? protectFormulaText(value) : value === null || value === undefined ? '' : String(value)
  return `"${String(safe).replace(/"/g, '""')}"`
}

export function createSmartTableCsv(table: SmartTable): string {
  const lines = [
    table.columns.map((column) => csvCell(column.label)).join(','),
    ...table.rows.map((row) => table.columns.map((column) => csvCell(row.values[column.id]?.value)).join(',')),
  ]
  return `\uFEFF${lines.join('\r\n')}`
}

export function createSmartTableTsv(table: SmartTable): string {
  const clean = (value: unknown) => protectFormulaText(value === null || value === undefined ? '' : String(value)).replace(/[\t\r\n]+/g, ' ')
  return [
    table.columns.map((column) => clean(column.label)).join('\t'),
    ...table.rows.map((row) => table.columns.map((column) => clean(row.values[column.id]?.value)).join('\t')),
  ].join('\r\n')
}

function excelDate(value: unknown): Date | string | null {
  if (value === null || value === undefined || value === '') return null
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!match) return protectFormulaText(String(value))
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0))
}

function xlsxValue(value: unknown, column: SmartTableColumn): string | number | boolean | Date | null {
  if (value === null || value === undefined || value === '') return null
  if (column.type === 'date' || column.type === 'datetime') return excelDate(value)
  if (['number', 'currency', 'percentage'].includes(column.type) && typeof value === 'number') return value
  if (column.type === 'boolean' && typeof value === 'boolean') return value
  return protectFormulaText(String(value))
}

function numberFormat(type: SmartTableColumnType): string | undefined {
  if (type === 'currency') return '¥#,##0.00'
  if (type === 'percentage') return '0.0%'
  if (type === 'date') return 'yyyy-mm-dd'
  if (type === 'datetime') return 'yyyy-mm-dd hh:mm:ss'
  return undefined
}

export function createSmartTableXlsx(table: SmartTable): Uint8Array {
  const data = [
    table.columns.map((column) => column.label),
    ...table.rows.map((row) => table.columns.map((column) => xlsxValue(row.values[column.id]?.value, column))),
  ]
  const sheet = XLSX.utils.aoa_to_sheet(data, { cellDates: true })
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, data.length - 1), c: Math.max(0, table.columns.length - 1) } }) }
  sheet['!cols'] = table.columns.map((column) => ({
    wch: Math.min(36, Math.max(10, column.label.length * 2 + 2, ...table.rows.slice(0, 200).map((row) => String(row.values[column.id]?.value ?? '').length + 2))),
  }))
  ;(sheet as XLSX.WorkSheet & { '!freeze'?: { xSplit: number; ySplit: number } })['!freeze'] = { xSplit: 0, ySplit: 1 }
  table.columns.forEach((column, columnIndex) => {
    const header = sheet[XLSX.utils.encode_cell({ r: 0, c: columnIndex })] as (XLSX.CellObject & { s?: unknown }) | undefined
    if (header) header.s = { font: { bold: true }, fill: { fgColor: { rgb: 'EDE9FE' } }, alignment: { vertical: 'center' } }
    const format = numberFormat(column.type)
    if (!format) return
    for (let rowIndex = 1; rowIndex < data.length; rowIndex += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })]
      if (cell) cell.z = format
    }
  })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, table.title.slice(0, 31).replace(/[\\/?*\[\]:]/g, '_') || '整理结果')
  const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', cellStyles: true }) as ArrayBuffer | Uint8Array
  return output instanceof Uint8Array ? output : new Uint8Array(output)
}
