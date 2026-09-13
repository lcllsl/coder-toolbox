import { NUMERIC_COLUMN_KINDS, type ColumnDefinition, type DataProfile, type NormalizedCell, type TabularDataset } from '../types'

const SENSITIVE_HEADER = /(身份证|证件号|手机号|手机号码|电话|银行卡|卡号|邮箱|email|密码|password|token|secret|access.?key|api.?key)/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^(?:\+?86[- ]?)?1[3-9]\d{9}$/
const ID_CARD = /^(?:\d{15}|\d{17}[\dXx])$/
const BANK_CARD = /^\d{16,19}$/
const TOKEN = /^(?:sk-|Bearer\s+|gh[pousr]_)[A-Za-z0-9_\-.]{12,}$/i

export function isSensitiveColumn(column: Pick<ColumnDefinition, 'label' | 'kind'>, values: NormalizedCell[]): boolean {
  if (SENSITIVE_HEADER.test(column.label)) return true
  if (column.kind === 'id' && values.some((value) => typeof value === 'string' && value.length >= 12)) return true
  const textValues = values.filter((value): value is string => typeof value === 'string').slice(0, 50)
  if (!textValues.length) return false
  const matches = textValues.filter((value) => [EMAIL, PHONE, ID_CARD, BANK_CARD, TOKEN].some((pattern) => pattern.test(value.replace(/\s/g, '')))).length
  return matches / textValues.length >= 0.35
}

function numericStats(values: NormalizedCell[]) {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (!numbers.length) return undefined
  const sum = numbers.reduce((total, value) => total + value, 0)
  return { min: Math.min(...numbers), max: Math.max(...numbers), sum, avg: sum / numbers.length }
}

export function createDataProfile(dataset: TabularDataset, sampleLimit = 12): DataProfile {
  const sensitivity = new Map<string, boolean>()
  const columns = dataset.columns.map((column) => {
    const values = dataset.rows.map((row) => row[column.key] ?? null)
    const populated = values.filter((value) => value !== null)
    const sensitive = isSensitiveColumn(column, populated)
    sensitivity.set(column.key, sensitive)
    return {
      name: column.key,
      type: column.kind,
      sensitive,
      nullableRate: values.length ? (values.length - populated.length) / values.length : 1,
      uniqueCount: new Set(populated.map((value) => JSON.stringify(value))).size,
      samples: sensitive ? ['[REDACTED]'] as ['[REDACTED]'] : [...new Set(populated)].slice(0, 5),
      stats: NUMERIC_COLUMN_KINDS.has(column.kind) ? numericStats(populated) : undefined,
    }
  })
  const sampleRows = dataset.rows.slice(0, Math.max(1, Math.min(sampleLimit, 20))).map((row) => Object.fromEntries(
    dataset.columns.map((column) => [column.key, sensitivity.get(column.key) ? '[REDACTED]' : row[column.key] ?? null]),
  ))
  return {
    fileName: dataset.fileName,
    sheetName: dataset.sheetName,
    rowCount: dataset.rows.length,
    columnCount: dataset.columns.length,
    columns,
    sampleRows,
  }
}
