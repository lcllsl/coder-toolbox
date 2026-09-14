import * as XLSX from 'xlsx'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import { createDataProfile } from '@/features/ai-office/smart-chart/excel/profiler'
import { createDataset, parseWorkbookData, renameDatasetColumn } from '@/features/ai-office/smart-chart/excel/parser'
import { detectHeaderRow } from '@/features/ai-office/smart-chart/excel/headerDetector'
import { inferColumnKind } from '@/features/ai-office/smart-chart/excel/typeInference'
import { createLocalReportSpec } from '@/features/ai-office/smart-chart/recommendation/localRecommender'
import { deleteSavedChartProject, getSavedChartProject, listSavedChartProjects, normalizeSavedChartTitle, renameSavedChartProject, saveChartProject } from '@/features/ai-office/smart-chart/repositories/saved-chart-repository'
import { buildReport } from '@/features/ai-office/smart-chart/report/dataProcessor'
import { exportReportHtml } from '@/features/ai-office/smart-chart/report/htmlExporter'
import { validateReportSpec } from '@/features/ai-office/smart-chart/report/validator'
import type { ReportSpec, TabularDataset } from '@/features/ai-office/smart-chart/types'

function salesDataset(): TabularDataset {
  return {
    fileName: '销售数据.xlsx', sheetName: '销售汇总', headerRow: 0,
    columns: [
      { key: '月份', label: '月份', sourceIndex: 0, kind: 'date', inferredKind: 'date', confidence: .95, sensitive: false },
      { key: '部门', label: '部门', sourceIndex: 1, kind: 'category', inferredKind: 'category', confidence: .9, sensitive: false },
      { key: '销售额', label: '销售额', sourceIndex: 2, kind: 'currency', inferredKind: 'currency', confidence: .95, sensitive: false },
      { key: '利润率', label: '利润率', sourceIndex: 3, kind: 'percentage', inferredKind: 'percentage', confidence: .95, sensitive: false },
      { key: '手机号', label: '手机号', sourceIndex: 4, kind: 'text', inferredKind: 'text', confidence: .8, sensitive: false },
    ],
    rows: [
      { 月份: '2026-01-01', 部门: '华东', 销售额: 120, 利润率: .2, 手机号: '13800138000' },
      { 月份: '2026-02-01', 部门: '华东', 销售额: 180, 利润率: .25, 手机号: '13900139000' },
      { 月份: '2026-01-01', 部门: '华南', 销售额: 90, 利润率: .18, 手机号: '13700137000' },
      { 月份: '2026-02-01', 部门: '华南', 销售额: 110, 利润率: .22, 手机号: '13600136000' },
    ],
  }
}

describe('smart chart spreadsheet pipeline', () => {
  beforeEach(() => localStorage.removeItem('petal-toolbox.smart-chart-projects'))

  it('detects a third-row header and basic column types', () => {
    const rows = [['销售月报'], [null], ['月份', '销售额', '完成率'], ['2026-01-01', 1200, '80%'], ['2026-02-01', 1500, '90%']]
    expect(detectHeaderRow(rows)).toBe(2)
    expect(inferColumnKind('销售额', [1200, 1500]).kind).toBe('currency')
    expect(inferColumnKind('完成率', ['80%', '90%']).kind).toBe('percentage')
  })

  it('parses multiple sheets and creates unique headers', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['名称', '金额'], ['A', 10]]), '汇总')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['字段', '字段'], ['A', 'B']]), '明细')
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const parsed = parseWorkbookData(bytes, 'demo.xlsx', bytes.byteLength)
    expect(parsed.sheets.map((sheet) => sheet.name)).toEqual(['汇总', '明细'])
    expect(createDataset(parsed, 1, 0).columns.map((column) => column.key)).toEqual(['字段', '字段 (2)'])
  })

  it('preserves Chinese text in UTF-8 CSV files without a BOM', () => {
    const csv = '月份,部门,销售额\n2026-01,华东,1200'
    const parsed = parseWorkbookData(csv, '销售.csv', new TextEncoder().encode(csv).byteLength, 'string')
    expect(createDataset(parsed, 0, 0).rows[0]).toMatchObject({ 月份: '2026-01', 部门: '华东', 销售额: 1200 })
  })

  it('preserves the spreadsheet date display without adding a timezone', () => {
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([['日期', '金额'], [new Date(2026, 8, 13), 100]])
    if (sheet.A2) sheet.A2.z = 'yyyy-mm-dd'
    XLSX.utils.book_append_sheet(workbook, sheet, '日期测试')
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', cellDates: true }) as ArrayBuffer
    const dataset = createDataset(parseWorkbookData(bytes, '日期.xlsx', bytes.byteLength), 0, 0)
    expect(dataset.rows[0].日期).toBe('2026-09-13')
    expect(String(dataset.rows[0].日期)).not.toMatch(/[TZ]|\+\d{2}:\d{2}/)
  })

  it('renames fields across columns, rows and generated report references while rejecting duplicates', () => {
    const dataset = renameDatasetColumn(salesDataset(), '销售额', '营业收入')
    expect(dataset.columns.map((column) => column.key)).toContain('营业收入')
    expect(dataset.rows[0]).toMatchObject({ 营业收入: 120 })
    const report = createLocalReportSpec(createDataProfile(dataset))
    expect(report.kpis.some((kpi) => kpi.field === '营业收入')).toBe(true)
    expect(report.charts.some((chart) => chart.valueFields.includes('营业收入'))).toBe(true)
    expect(() => renameDatasetColumn(dataset, '部门', '月份')).toThrow('column_name_duplicate')
  })

  it('redacts sensitive samples while keeping local statistics', () => {
    const profile = createDataProfile(salesDataset())
    expect(profile.columns.find((column) => column.name === '手机号')).toMatchObject({ sensitive: true, samples: ['[REDACTED]'] })
    expect(profile.sampleRows[0].手机号).toBe('[REDACTED]')
    expect(profile.columns.find((column) => column.name === '销售额')?.stats?.sum).toBe(500)
  })

  it('creates a usable local fallback and validates all referenced fields', () => {
    const profile = createDataProfile(salesDataset())
    const local = createLocalReportSpec(profile)
    expect(local.charts.length).toBeGreaterThanOrEqual(3)
    expect(validateReportSpec(local, profile).success).toBe(true)
    expect(validateReportSpec({
      ...local,
      charts: local.charts.map((chart, index) => index === 0 ? { ...chart, valueFields: ['不存在'] } : chart),
    }, profile)).toEqual({ success: false, reason: 'report_non_numeric_series' })
  })

  it('aggregates KPIs and category series locally', () => {
    const profile = createDataProfile(salesDataset())
    const report = buildReport(salesDataset(), createLocalReportSpec(profile))
    expect(report.kpis.find((kpi) => kpi.field === '销售额')?.value).toBe(500)
    const department = report.charts.find((chart) => chart.spec.categoryField === '部门')
    expect(department?.categories).toContain('华东')
  })

  it('exports one self-contained HTML file without executing cell HTML', async () => {
    const dataset = salesDataset()
    dataset.rows[0].部门 = '</script><script>alert("x")</script>'
    const spec = createLocalReportSpec(createDataProfile(dataset))
    const html = await exportReportHtml(buildReport(dataset, spec))
    expect(html).toContain('<script>')
    expect(html).not.toContain('</script><script>alert')
    expect(html).not.toMatch(/<script\s+src=/)
    expect(html).toContain('\\u003c/script\\u003e')
  })

  it('rejects unsupported chart types and more than six charts', () => {
    const profile = createDataProfile(salesDataset())
    const local = createLocalReportSpec(profile)
    const unsupported = { ...local, charts: [{ ...local.charts[0], type: 'radar' }] }
    expect(validateReportSpec(unsupported, profile).success).toBe(false)
    const tooMany = { ...local, charts: Array.from({ length: 7 }, (_, index) => ({ ...local.charts[0], id: `chart-${index}` })) } as ReportSpec
    expect(validateReportSpec(tooMany, profile).success).toBe(false)
  })

  it('saves, lists, opens, updates and deletes chart projects locally', async () => {
    const dataset = salesDataset()
    const reportSpec = createLocalReportSpec(createDataProfile(dataset))
    const saved = await saveChartProject({
      title: ' 月度销售图表 ',
      dataset: reactive(dataset),
      reportSpec: reactive(reportSpec),
      now: '2026-09-13T10:00:00.000Z',
    })
    expect(await listSavedChartProjects()).toMatchObject([{ id: saved.id, title: '月度销售图表', chartCount: reportSpec.charts.length }])
    expect((await getSavedChartProject(saved.id))?.dataset.rows).toHaveLength(4)
    const updated = await saveChartProject({ id: saved.id, title: '月度销售图表', dataset, reportSpec: { ...reportSpec, reportTitle: '更新后的报告' }, now: '2026-09-13T11:00:00.000Z' })
    expect(updated.createdAt).toBe(saved.createdAt)
    expect((await listSavedChartProjects())[0].title).toBe('月度销售图表')
    await renameSavedChartProject(saved.id, ' 销售经营看板 ', '2026-09-13T12:00:00.000Z')
    expect((await listSavedChartProjects())[0]).toMatchObject({ title: '销售经营看板', updatedAt: '2026-09-13T12:00:00.000Z' })
    expect(() => normalizeSavedChartTitle('   ')).toThrow('saved_chart_title_empty')
    await deleteSavedChartProject(saved.id)
    expect(await listSavedChartProjects()).toEqual([])
  })
})
