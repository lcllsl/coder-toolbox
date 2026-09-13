import * as XLSX from 'xlsx'

import { createUniqueHeaders, detectHeaderRow } from './headerDetector'
import { inferColumnKind, normalizeCell } from './typeInference'
import type { ColumnDefinition, ParsedWorkbook, SpreadsheetCell, TabularDataset, WorkbookSheet } from '../types'

export const SPREADSHEET_WARNING_BYTES = 20 * 1024 * 1024
export const SPREADSHEET_MAX_BYTES = 50 * 1024 * 1024
const SUPPORTED_EXTENSIONS = ['.xlsx', '.xls', '.csv']

export function validateSpreadsheetFile(fileName: string, sizeBytes: number): void {
  const lower = fileName.toLowerCase()
  if (!SUPPORTED_EXTENSIONS.some((extension) => lower.endsWith(extension))) throw new Error('unsupported_spreadsheet_type')
  if (sizeBytes > SPREADSHEET_MAX_BYTES) throw new Error('spreadsheet_too_large')
  if (sizeBytes <= 0) throw new Error('spreadsheet_empty_file')
}

function toSpreadsheetCell(value: unknown): SpreadsheetCell {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}

export function parseWorkbookData(data: ArrayBuffer | string, fileName: string, sizeBytes: number, inputType: 'array' | 'base64' | 'string' = 'array'): ParsedWorkbook {
  validateSpreadsheetFile(fileName, sizeBytes)
  const workbook = XLSX.read(data, {
    type: inputType,
    cellDates: true,
    cellFormula: false,
    cellHTML: false,
    dense: true,
    raw: true,
    codepage: 65001,
  })
  const sheets: WorkbookSheet[] = workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name]
    const raw = worksheet
      ? XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: true, defval: null, blankrows: false })
      : []
    const rawRows = raw.map((row) => row.map(toSpreadsheetCell))
    const columnCount = rawRows.reduce((max, row) => Math.max(max, row.length), 0)
    return { name, rawRows, rowCount: rawRows.length, columnCount, detectedHeaderRow: detectHeaderRow(rawRows) }
  })
  return { fileName, sizeBytes, sheets }
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedWorkbook> {
  return file.name.toLowerCase().endsWith('.csv')
    ? parseWorkbookData(await file.text(), file.name, file.size, 'string')
    : parseWorkbookData(await file.arrayBuffer(), file.name, file.size)
}

export function decodeBase64Utf8(value: string): string {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder('utf-8').decode(bytes)
}

export function createDataset(workbook: ParsedWorkbook, sheetIndex: number, headerRow: number): TabularDataset {
  const sheet = workbook.sheets[sheetIndex]
  if (!sheet) throw new Error('spreadsheet_sheet_missing')
  const safeHeaderRow = Math.max(0, Math.min(headerRow, Math.max(sheet.rawRows.length - 1, 0)))
  const rawDataRows = sheet.rawRows.slice(safeHeaderRow + 1).filter((row) => row.some((value) => value !== null && value !== ''))
  const columnCount = Math.max(sheet.columnCount, sheet.rawRows[safeHeaderRow]?.length ?? 0)
  const headers = createUniqueHeaders(sheet.rawRows[safeHeaderRow] ?? [], columnCount)
  const columns: ColumnDefinition[] = headers.map((label, sourceIndex) => {
    const inference = inferColumnKind(label, rawDataRows.slice(0, 500).map((row) => row[sourceIndex] ?? null))
    return {
      key: label,
      label,
      sourceIndex,
      kind: inference.kind,
      inferredKind: inference.kind,
      confidence: inference.confidence,
      sensitive: false,
    }
  })
  const rows = rawDataRows.map((rawRow) => Object.fromEntries(
    columns.map((column) => [column.key, normalizeCell(rawRow[column.sourceIndex] ?? null, column.kind)]),
  ))
  return { fileName: workbook.fileName, sheetName: sheet.name, headerRow: safeHeaderRow, columns, rows }
}

export function updateColumnKind(dataset: TabularDataset, columnKey: string, kind: ColumnDefinition['kind']): TabularDataset {
  const sourceColumn = dataset.columns.find((column) => column.key === columnKey)
  if (!sourceColumn) return dataset
  const columns = dataset.columns.map((column) => column.key === columnKey ? { ...column, kind } : column)
  const rows = dataset.rows.map((row) => ({ ...row, [columnKey]: normalizeCell(row[columnKey], kind) }))
  return { ...dataset, columns, rows }
}
