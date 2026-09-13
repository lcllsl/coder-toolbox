import type { Aggregation, BuiltReport, DataRow, KpiFormat, KpiResult, ProcessedChart, ReportSpec, TabularDataset } from '../types'

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function aggregate(values: number[], aggregation: Aggregation): number {
  if (aggregation === 'count') return values.length
  if (!values.length) return 0
  if (aggregation === 'sum') return values.reduce((sum, value) => sum + value, 0)
  if (aggregation === 'avg') return values.reduce((sum, value) => sum + value, 0) / values.length
  if (aggregation === 'max') return Math.max(...values)
  return Math.min(...values)
}

export function formatMetric(value: number, format: KpiFormat): string {
  if (format === 'percentage') return new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 }).format(value)
  if (format === 'currency') return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 }).format(value)
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, notation: Math.abs(value) >= 10_000_000 ? 'compact' : 'standard' }).format(value)
}

function processKpis(spec: ReportSpec, rows: DataRow[]): KpiResult[] {
  return spec.kpis.map((kpi) => {
    const value = kpi.field === '*'
      ? rows.length
      : aggregate(rows.map((row) => finiteNumber(row[kpi.field])).filter((item): item is number => item !== null), kpi.aggregation)
    return { ...kpi, value, displayValue: formatMetric(value, kpi.format) }
  })
}

function categoryLabel(value: unknown, index: number): string {
  if (value === null || value === undefined || value === '') return `未填写 ${index + 1}`
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

function processScatter(spec: ProcessedChart['spec'], rows: DataRow[]): ProcessedChart {
  const valueField = spec.valueFields[0]
  const pairs = rows.flatMap((row) => {
    const x = finiteNumber(row[spec.categoryField])
    const y = finiteNumber(row[valueField])
    return x === null || y === null ? [] : [[x, y] as [number, number]]
  }).slice(0, spec.limit ?? 200)
  return { spec, categories: [], series: [{ name: valueField, values: pairs }] }
}

function processGroupedChart(spec: ProcessedChart['spec'], rows: DataRow[]): ProcessedChart {
  const groups = new Map<string, Map<string, number[]>>()
  rows.forEach((row, index) => {
    const category = categoryLabel(row[spec.categoryField], index)
    const group = groups.get(category) ?? new Map<string, number[]>()
    for (const field of spec.valueFields) {
      const value = finiteNumber(row[field])
      if (value === null && spec.aggregation !== 'count') continue
      const values = group.get(field) ?? []
      values.push(value ?? 1)
      group.set(field, values)
    }
    groups.set(category, group)
  })
  let entries = [...groups.entries()].map(([category, group]) => ({
    category,
    values: Object.fromEntries(spec.valueFields.map((field) => [field, aggregate(group.get(field) ?? [], spec.aggregation)])),
  }))
  if (spec.sort !== 'none') {
    const field = spec.valueFields[0]
    entries.sort((a, b) => (a.values[field] - b.values[field]) * (spec.sort === 'asc' ? 1 : -1))
  }
  entries = entries.slice(0, spec.limit ?? 200)
  return {
    spec,
    categories: entries.map((entry) => entry.category),
    series: spec.valueFields.map((field) => ({ name: field, values: entries.map((entry) => entry.values[field]) })),
  }
}

export function buildReport(dataset: TabularDataset, spec: ReportSpec): BuiltReport {
  return {
    spec,
    kpis: processKpis(spec, dataset.rows),
    charts: spec.charts.map((chart) => chart.type === 'scatter' ? processScatter(chart, dataset.rows) : processGroupedChart(chart, dataset.rows)),
    source: { fileName: dataset.fileName, sheetName: dataset.sheetName, rowCount: dataset.rows.length },
  }
}
