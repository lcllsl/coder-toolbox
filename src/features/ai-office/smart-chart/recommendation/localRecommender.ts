import type { ChartSpec, DataProfile, KpiSpec, ReportSpec } from '../types'
import { NUMERIC_COLUMN_KINDS } from '../types'

function idFor(prefix: string, index: number) {
  return `${prefix}-${index + 1}`
}

export function createLocalReportSpec(profile: DataProfile): ReportSpec {
  const usable = profile.columns.filter((column) => !column.sensitive && !['id', 'long_text', 'unknown'].includes(column.type))
  const numbers = usable.filter((column) => NUMERIC_COLUMN_KINDS.has(column.type))
  const dates = usable.filter((column) => ['date', 'datetime'].includes(column.type))
  const categories = usable.filter((column) => ['category', 'text', 'boolean'].includes(column.type))
  const fallbackCategory = dates[0] ?? categories[0] ?? numbers[0] ?? profile.columns[0]
  const fallbackValue = numbers[0]

  const kpis: KpiSpec[] = numbers.slice(0, 3).map((column, index) => ({
    id: idFor('kpi', index),
    label: `${column.name}${column.type === 'percentage' ? '平均值' : '合计'}`,
    field: column.name,
    aggregation: column.type === 'percentage' ? 'avg' : 'sum',
    format: column.type === 'currency' ? 'currency' : column.type === 'percentage' ? 'percentage' : 'number',
  }))
  kpis.push({ id: 'record-count', label: '数据记录', field: '*', aggregation: 'count', format: 'number' })

  const charts: ChartSpec[] = []
  if (dates[0] && numbers[0]) charts.push({
    id: 'trend-1', title: `${numbers[0].name}变化趋势`, description: `按${dates[0].name}展示变化。`, type: 'line',
    categoryField: dates[0].name, valueFields: numbers.slice(0, 2).map((column) => column.name), aggregation: 'sum', sort: 'asc', limit: null,
  })
  if (categories[0] && numbers[0]) charts.push({
    id: 'compare-1', title: `各${categories[0].name}${numbers[0].name}对比`, type: 'bar', categoryField: categories[0].name,
    valueFields: [numbers[0].name], aggregation: 'sum', sort: 'desc', limit: 12,
  })
  const compactCategory = categories.find((column) => column.uniqueCount >= 2 && column.uniqueCount <= 9)
  if (compactCategory && numbers[0]) charts.push({
    id: 'share-1', title: `${numbers[0].name}构成`, type: 'donut', categoryField: compactCategory.name,
    valueFields: [numbers[0].name], aggregation: 'sum', sort: 'desc', limit: 9,
  })
  if (numbers.length >= 2) charts.push({
    id: 'relation-1', title: `${numbers[0].name}与${numbers[1].name}关系`, type: 'scatter', categoryField: numbers[0].name,
    valueFields: [numbers[1].name], aggregation: 'avg', sort: 'none', limit: 50,
  })

  if (fallbackCategory && fallbackValue) {
    const fillTypes: ChartSpec['type'][] = ['horizontal-bar', 'area', 'bar']
    while (charts.length < 3) {
      const index = charts.length
      charts.push({
        id: idFor('overview', index), title: `${fallbackValue.name}概览 ${index + 1}`, type: fillTypes[index % fillTypes.length],
        categoryField: fallbackCategory.name, valueFields: [fallbackValue.name], aggregation: fallbackValue.type === 'percentage' ? 'avg' : 'sum', sort: index ? 'desc' : 'none', limit: 12,
      })
    }
  }

  return {
    version: 1,
    reportTitle: `${profile.sheetName} 数据概览`,
    reportSubtitle: `${profile.fileName} · ${profile.rowCount} 条记录`,
    kpis: kpis.slice(0, 4),
    charts: charts.slice(0, 6),
  }
}
