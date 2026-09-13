import type { SpreadsheetCell } from '../types'

function nonEmpty(value: SpreadsheetCell): boolean {
  return value !== null && value !== ''
}

function rowScore(rows: SpreadsheetCell[][], rowIndex: number): number {
  const row = rows[rowIndex] ?? []
  const nextRows = rows.slice(rowIndex + 1, rowIndex + 4)
  const filled = row.filter(nonEmpty)
  if (filled.length < 2) return -1

  const stringRatio = filled.filter((value) => typeof value === 'string').length / filled.length
  const uniqueness = new Set(filled.map((value) => String(value).trim().toLowerCase())).size / filled.length
  const followingDensity = nextRows.length
    ? nextRows.reduce((sum, next) => sum + next.filter(nonEmpty).length / Math.max(row.length, 1), 0) / nextRows.length
    : 0
  const beforePenalty = rows.slice(0, rowIndex).some((candidate) => candidate.filter(nonEmpty).length > filled.length)
    ? 0.5
    : 0

  return filled.length * 0.35 + stringRatio * 2 + uniqueness + followingDensity * 2 - rowIndex * 0.06 - beforePenalty
}

export function detectHeaderRow(rows: SpreadsheetCell[][], scanLimit = 12): number {
  if (!rows.length) return 0
  let bestIndex = 0
  let bestScore = Number.NEGATIVE_INFINITY
  for (let index = 0; index < Math.min(rows.length, scanLimit); index += 1) {
    const score = rowScore(rows, index)
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }
  return bestIndex
}

export function createUniqueHeaders(row: SpreadsheetCell[], columnCount: number): string[] {
  const counts = new Map<string, number>()
  return Array.from({ length: columnCount }, (_, index) => {
    const raw = row[index]
    const base = raw === null || String(raw).trim() === '' ? `字段 ${index + 1}` : String(raw).trim()
    const count = (counts.get(base) ?? 0) + 1
    counts.set(base, count)
    return count === 1 ? base : `${base} (${count})`
  })
}
