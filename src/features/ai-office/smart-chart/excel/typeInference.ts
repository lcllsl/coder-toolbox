import type { ColumnKind, SpreadsheetCell } from '../types'

const BOOLEAN_TEXT = new Set(['true', 'false', 'yes', 'no', '是', '否', '有', '无'])
const ID_HEADER = /(^id$|编号|编码|序号|订单号|工号|证件号|账号|code$)/i
const CURRENCY_HEADER = /(金额|收入|销售额|成本|利润|价格|单价|薪资|预算|revenue|sales|cost|price|amount|profit)/i
const PERCENT_HEADER = /(率|比例|百分比|占比|增长率|完成率|margin|rate|ratio|percent|%)/i
const DATE_HEADER = /(日期|时间|年月|月份|季度|date|time|month|year)/i

function isDateText(value: string): boolean {
  const text = value.trim()
  const optionalTime = '(?:[ T]\\d{1,2}:\\d{2}(?::\\d{2})?)?'
  const yearFirst = new RegExp(`^\\d{4}[-/.年]\\d{1,2}(?:[-/.月]\\d{1,2}日?)?${optionalTime}$`)
  const yearLast = new RegExp(`^\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4}${optionalTime}$`)
  return yearFirst.test(text) || yearLast.test(text)
}

function isNumericText(value: string): boolean {
  const normalized = value.trim().replace(/[￥¥$€£,，\s]/g, '').replace(/%$/, '')
  return normalized !== '' && Number.isFinite(Number(normalized))
}

function classifyValue(value: SpreadsheetCell): ColumnKind {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getHours() || value.getMinutes() || value.getSeconds() ? 'datetime' : 'date'
  }
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number' && Number.isFinite(value)) return 'number'
  if (typeof value !== 'string') return 'unknown'
  const trimmed = value.trim()
  if (!trimmed) return 'unknown'
  if (BOOLEAN_TEXT.has(trimmed.toLowerCase())) return 'boolean'
  if (isDateText(trimmed)) return trimmed.includes(':') ? 'datetime' : 'date'
  if (/^-?[\d,.]+\s*%$/.test(trimmed)) return 'percentage'
  if (/^[￥¥$€£]\s*-?[\d,.]+$/.test(trimmed)) return 'currency'
  if (isNumericText(trimmed)) return 'number'
  return trimmed.length > 80 ? 'long_text' : 'text'
}

export interface InferenceResult {
  kind: ColumnKind
  confidence: number
}

export function inferColumnKind(header: string, values: SpreadsheetCell[]): InferenceResult {
  const populated = values.filter((value) => value !== null && value !== '')
  if (!populated.length) return { kind: 'unknown', confidence: 0 }

  const classifications = populated.map(classifyValue)
  const counts = classifications.reduce((map, kind) => map.set(kind, (map.get(kind) ?? 0) + 1), new Map<ColumnKind, number>())
  const [dominant = 'unknown', dominantCount = 0] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  const confidence = dominantCount / populated.length
  const uniqueRatio = new Set(populated.map((value) => String(value))).size / populated.length

  if (ID_HEADER.test(header) && uniqueRatio > 0.7) return { kind: 'id', confidence: Math.max(confidence, 0.88) }
  if (PERCENT_HEADER.test(header) && ['number', 'percentage'].includes(dominant)) return { kind: 'percentage', confidence: Math.max(confidence, 0.85) }
  if (CURRENCY_HEADER.test(header) && ['number', 'currency'].includes(dominant)) return { kind: 'currency', confidence: Math.max(confidence, 0.85) }
  if (DATE_HEADER.test(header) && ['date', 'datetime'].includes(dominant)) return { kind: dominant, confidence: Math.max(confidence, 0.85) }
  if (dominant === 'text' && uniqueRatio <= 0.5 && populated.length >= 4) return { kind: 'category', confidence: Math.max(confidence, 0.78) }
  return { kind: dominant, confidence }
}

export function normalizeCell(value: SpreadsheetCell, kind: ColumnKind): string | number | boolean | null {
  if (value === null || value === '') return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    const pad = (part: number) => String(part).padStart(2, '0')
    const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
    return value.getHours() || value.getMinutes() || value.getSeconds()
      ? `${date} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
      : date
  }
  if (kind === 'boolean') {
    if (typeof value === 'boolean') return value
    return ['true', 'yes', '是', '有'].includes(String(value).trim().toLowerCase())
  }
  if (['number', 'currency', 'percentage'].includes(kind)) {
    if (typeof value === 'number') return value
    const text = String(value).trim()
    const numeric = Number(text.replace(/[￥¥$€£,，\s]/g, '').replace(/%$/, ''))
    if (!Number.isFinite(numeric)) return null
    return kind === 'percentage' && text.endsWith('%') ? numeric / 100 : numeric
  }
  return String(value)
}
