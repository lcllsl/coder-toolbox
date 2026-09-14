import type { DataProfile, ReportSpec } from '../types'
import { NUMERIC_COLUMN_KINDS } from '../types'
import { reportSpecSchema } from './reportSpec'

export interface ValidationResult {
  success: boolean
  report?: ReportSpec
  reason?: string
}

const VALIDATION_MESSAGES: Record<string, string> = {
  report_schema_invalid: 'AI 规划的结构或图表数量不符合要求',
  report_duplicate_id: 'AI 规划中存在重复的图表标识',
  report_unknown_field: 'AI 规划引用了不存在的字段',
  report_non_numeric_kpi: 'AI 规划的统计卡片引用了非数值字段',
  report_scatter_axis_invalid: 'AI 规划的散点图坐标轴不是数值字段',
  report_non_numeric_series: 'AI 规划的图表数值系列引用无效字段',
}

export function reportValidationMessage(reason?: string): string {
  return reason ? VALIDATION_MESSAGES[reason] ?? '未知的规划校验错误' : '未知的规划校验错误'
}

export function validateReportSpec(input: unknown, profile: DataProfile): ValidationResult {
  const parsed = reportSpecSchema.safeParse(input)
  if (!parsed.success) return { success: false, reason: 'report_schema_invalid' }
  const fields = new Map(profile.columns.map((column) => [column.name, column]))
  const ids = new Set<string>()
  for (const kpi of parsed.data.kpis) {
    if (ids.has(kpi.id)) return { success: false, reason: 'report_duplicate_id' }
    ids.add(kpi.id)
    if (kpi.field !== '*' && !fields.has(kpi.field)) return { success: false, reason: 'report_unknown_field' }
    if (kpi.field !== '*' && kpi.aggregation !== 'count' && !NUMERIC_COLUMN_KINDS.has(fields.get(kpi.field)!.type)) {
      return { success: false, reason: 'report_non_numeric_kpi' }
    }
  }
  for (const chart of parsed.data.charts) {
    if (ids.has(chart.id)) return { success: false, reason: 'report_duplicate_id' }
    ids.add(chart.id)
    const category = fields.get(chart.categoryField)
    if (!category) return { success: false, reason: 'report_unknown_field' }
    if (chart.type === 'scatter' && !NUMERIC_COLUMN_KINDS.has(category.type)) return { success: false, reason: 'report_scatter_axis_invalid' }
    if (chart.valueFields.some((field) => !fields.has(field) || !NUMERIC_COLUMN_KINDS.has(fields.get(field)!.type))) {
      return { success: false, reason: 'report_non_numeric_series' }
    }
  }
  return { success: true, report: parsed.data as ReportSpec }
}
