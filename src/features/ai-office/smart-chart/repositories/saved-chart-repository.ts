import Database from '@tauri-apps/plugin-sql'

import { isTauriRuntime } from '@/services/tauri/runtime'
import type { ReportSpec, SavedChartProject, SavedChartSummary, TabularDataset } from '../types'

const BROWSER_KEY = 'petal-toolbox.smart-chart-projects'
let database: Promise<Database> | undefined

interface SavedChartRow {
  id: string
  title: string
  fileName: string
  sheetName: string
  rowCount: number
  chartCount: number
  kpiCount: number
  datasetJson?: string
  reportSpecJson?: string
  createdAt: string
  updatedAt: string
}

function getDatabase() {
  database ??= Database.load('sqlite:petal-toolbox.db')
  return database
}

function browserProjects(): SavedChartProject[] {
  try {
    const value = JSON.parse(localStorage.getItem(BROWSER_KEY) ?? '[]')
    return Array.isArray(value) ? value as SavedChartProject[] : []
  } catch {
    return []
  }
}

function saveBrowserProjects(projects: SavedChartProject[]) {
  localStorage.setItem(BROWSER_KEY, JSON.stringify(projects))
}

export function normalizeSavedChartTitle(value: string): string {
  const title = value.trim()
  if (!title) throw new Error('saved_chart_title_empty')
  if (title.length > 80) throw new Error('saved_chart_title_too_long')
  return title
}

function toSummary(project: SavedChartProject): SavedChartSummary {
  const { dataset: _dataset, reportSpec: _reportSpec, ...summary } = project
  return summary
}

function mapSummary(row: SavedChartRow): SavedChartSummary {
  return {
    id: row.id,
    title: row.title,
    fileName: row.fileName,
    sheetName: row.sheetName,
    rowCount: Number(row.rowCount),
    chartCount: Number(row.chartCount),
    kpiCount: Number(row.kpiCount),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function listSavedChartProjects(): Promise<SavedChartSummary[]> {
  if (!isTauriRuntime()) {
    return browserProjects().map(toSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  const rows = await (await getDatabase()).select<SavedChartRow[]>(
    `SELECT id, title, file_name AS fileName, sheet_name AS sheetName,
      row_count AS rowCount, chart_count AS chartCount, kpi_count AS kpiCount,
      created_at AS createdAt, updated_at AS updatedAt
     FROM smart_chart_projects ORDER BY updated_at DESC`,
  )
  return rows.map(mapSummary)
}

export async function getSavedChartProject(id: string): Promise<SavedChartProject | undefined> {
  if (!isTauriRuntime()) return browserProjects().find((project) => project.id === id)
  const rows = await (await getDatabase()).select<SavedChartRow[]>(
    `SELECT id, title, file_name AS fileName, sheet_name AS sheetName,
      row_count AS rowCount, chart_count AS chartCount, kpi_count AS kpiCount,
      dataset_json AS datasetJson, report_spec_json AS reportSpecJson,
      created_at AS createdAt, updated_at AS updatedAt
     FROM smart_chart_projects WHERE id = $1 LIMIT 1`,
    [id],
  )
  const row = rows[0]
  if (!row?.datasetJson || !row.reportSpecJson) return undefined
  try {
    return {
      ...mapSummary(row),
      dataset: JSON.parse(row.datasetJson) as TabularDataset,
      reportSpec: JSON.parse(row.reportSpecJson) as ReportSpec,
    }
  } catch {
    return undefined
  }
}

export async function saveChartProject(input: {
  id?: string
  title: string
  dataset: TabularDataset
  reportSpec: ReportSpec
  now?: string
}): Promise<SavedChartProject> {
  const now = input.now ?? new Date().toISOString()
  const existing = input.id ? await getSavedChartProject(input.id) : undefined
  const title = normalizeSavedChartTitle(input.title)
  const datasetJson = JSON.stringify(input.dataset)
  const reportSpecJson = JSON.stringify(input.reportSpec)
  const project: SavedChartProject = {
    id: existing?.id ?? crypto.randomUUID(),
    title,
    fileName: input.dataset.fileName,
    sheetName: input.dataset.sheetName,
    rowCount: input.dataset.rows.length,
    chartCount: input.reportSpec.charts.length,
    kpiCount: input.reportSpec.kpis.length,
    dataset: JSON.parse(datasetJson) as TabularDataset,
    reportSpec: JSON.parse(reportSpecJson) as ReportSpec,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  if (!isTauriRuntime()) {
    saveBrowserProjects([project, ...browserProjects().filter((item) => item.id !== project.id)])
    return project
  }
  await (await getDatabase()).execute(
    `INSERT INTO smart_chart_projects
      (id, title, file_name, sheet_name, row_count, chart_count, kpi_count,
       dataset_json, report_spec_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT(id) DO UPDATE SET
       title = $2, file_name = $3, sheet_name = $4, row_count = $5,
       chart_count = $6, kpi_count = $7, dataset_json = $8,
       report_spec_json = $9, updated_at = $11`,
    [project.id, project.title, project.fileName, project.sheetName, project.rowCount,
      project.chartCount, project.kpiCount, datasetJson,
      reportSpecJson, project.createdAt, project.updatedAt],
  )
  return project
}

export async function renameSavedChartProject(id: string, value: string, now = new Date().toISOString()): Promise<void> {
  const title = normalizeSavedChartTitle(value)
  if (!isTauriRuntime()) {
    saveBrowserProjects(browserProjects().map((project) => project.id === id
      ? { ...project, title, updatedAt: now }
      : project))
    return
  }
  await (await getDatabase()).execute(
    'UPDATE smart_chart_projects SET title = $1, updated_at = $2 WHERE id = $3',
    [title, now, id],
  )
}

export async function deleteSavedChartProject(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    saveBrowserProjects(browserProjects().filter((project) => project.id !== id))
    return
  }
  await (await getDatabase()).execute('DELETE FROM smart_chart_projects WHERE id = $1', [id])
}

export async function clearSavedChartProjects(): Promise<void> {
  if (!isTauriRuntime()) {
    localStorage.removeItem(BROWSER_KEY)
    return
  }
  await (await getDatabase()).execute('DELETE FROM smart_chart_projects')
}
