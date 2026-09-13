export type SpreadsheetCell = string | number | boolean | Date | null

export type ColumnKind =
  | 'text'
  | 'category'
  | 'number'
  | 'currency'
  | 'percentage'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'id'
  | 'long_text'
  | 'unknown'

export interface WorkbookSheet {
  name: string
  rawRows: SpreadsheetCell[][]
  rowCount: number
  columnCount: number
  detectedHeaderRow: number
}

export interface ParsedWorkbook {
  fileName: string
  sizeBytes: number
  sheets: WorkbookSheet[]
}

export interface ColumnDefinition {
  key: string
  label: string
  sourceIndex: number
  kind: ColumnKind
  inferredKind: ColumnKind
  confidence: number
  sensitive: boolean
}

export type NormalizedCell = string | number | boolean | null
export type DataRow = Record<string, NormalizedCell>

export interface TabularDataset {
  fileName: string
  sheetName: string
  headerRow: number
  columns: ColumnDefinition[]
  rows: DataRow[]
}

export interface NumericStats {
  min: number
  max: number
  sum: number
  avg: number
}

export interface ColumnProfile {
  name: string
  type: ColumnKind
  sensitive: boolean
  nullableRate: number
  uniqueCount: number
  samples: NormalizedCell[] | ['[REDACTED]']
  stats?: NumericStats
}

export interface DataProfile {
  fileName: string
  sheetName: string
  rowCount: number
  columnCount: number
  columns: ColumnProfile[]
  sampleRows: Record<string, NormalizedCell | '[REDACTED]'>[]
}

export type Aggregation = 'sum' | 'avg' | 'max' | 'min' | 'count'
export type KpiFormat = 'number' | 'currency' | 'percentage'
export type ChartType = 'bar' | 'horizontal-bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter'
export type ChartSort = 'none' | 'asc' | 'desc'

export interface KpiSpec {
  id: string
  label: string
  field: string
  aggregation: Aggregation
  format: KpiFormat
}

export interface ChartSpec {
  id: string
  title: string
  description?: string
  type: ChartType
  categoryField: string
  valueFields: string[]
  aggregation: Aggregation
  sort: ChartSort
  limit: number | null
}

export interface ReportSpec {
  version: 1
  reportTitle: string
  reportSubtitle: string
  kpis: KpiSpec[]
  charts: ChartSpec[]
}

export interface KpiResult extends KpiSpec {
  value: number
  displayValue: string
}

export interface ProcessedChart {
  spec: ChartSpec
  categories: string[]
  series: { name: string; values: number[] | [number, number][] }[]
}

export interface BuiltReport {
  spec: ReportSpec
  kpis: KpiResult[]
  charts: ProcessedChart[]
  source: { fileName: string; sheetName: string; rowCount: number }
}

export const COLUMN_KIND_LABELS: Record<ColumnKind, string> = {
  text: '文本',
  category: '分类',
  number: '数字',
  currency: '金额',
  percentage: '百分比',
  date: '日期',
  datetime: '日期时间',
  boolean: '布尔值',
  id: '标识符',
  long_text: '长文本',
  unknown: '未知',
}

export const NUMERIC_COLUMN_KINDS = new Set<ColumnKind>(['number', 'currency', 'percentage'])
