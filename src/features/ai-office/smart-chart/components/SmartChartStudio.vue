<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ArrowLeft, BarChart3, CalendarClock, Check, ChevronRight, Download, FileSpreadsheet, FolderOpen, LoaderCircle, Pencil, Plus, RotateCcw, Save, Settings, ShieldCheck, Sparkles, Trash2, Undo2, UploadCloud } from '@lucide/vue'

import { useFeedbackStore } from '@/app/stores/feedback'
import { useSettingsStore } from '@/app/stores/settings'
import { createDataProfile } from '../excel/profiler'
import { createDataset, decodeBase64Utf8, parseSpreadsheetFile, parseWorkbookData, renameDatasetColumn, SPREADSHEET_WARNING_BYTES, updateColumnKind } from '../excel/parser'
import { createLocalReportSpec, hasChartableColumns } from '../recommendation/localRecommender'
import { deleteSavedChartProject, getSavedChartProject, listSavedChartProjects, renameSavedChartProject, saveChartProject } from '../repositories/saved-chart-repository'
import { buildReport } from '../report/dataProcessor'
import { createReportFileName, exportReportHtml } from '../report/htmlExporter'
import { reportValidationMessage, validateReportSpec } from '../report/validator'
import { COLUMN_KIND_LABELS, type ChartSpec, type ChartType, type ColumnKind, type KpiSpec, type ParsedWorkbook, type ReportSpec, type SavedChartSummary, type TabularDataset } from '../types'
import { aiErrorMessage, generateAiChartPlan, getAiStatus, openReportHtml, readNativeSpreadsheet, saveReportHtml } from '@/services/tauri/ai'
import { onFileSystemDrop } from '@/services/tauri/files'
import { showSettings } from '@/services/tauri/windows'
import EChartCard from './EChartCard.vue'
import ChartNameDialog from './ChartNameDialog.vue'
import PrivacyDialog from './PrivacyDialog.vue'

const emit = defineEmits<{ back: [] }>()
const props = defineProps<{ initialDataset?: TabularDataset }>()
type Stage = 'library' | 'import' | 'prepare' | 'generating' | 'report'
const feedback = useFeedbackStore()
const settings = useSettingsStore()
const stage = ref<Stage>('library')
const workbook = ref<ParsedWorkbook>()
const dataset = ref<TabularDataset>()
const sheetIndex = ref(0)
const headerRow = ref(0)
const parsing = ref(false)
const dragging = ref(false)
const fileError = ref('')
const fieldError = ref('')
const hasApiKey = ref(false)
const generationStep = ref(0)
const generationNotice = ref('')
const privacyOpen = ref(false)
const sessionPrivacyAccepted = ref(false)
const reportSpec = ref<ReportSpec>()
const originalSpec = ref<ReportSpec>()
const deletedKpis = ref<{ kpi: KpiSpec; index: number }[]>([])
const exportedPath = ref('')
const savedProjects = ref<SavedChartSummary[]>([])
const activeProjectId = ref<string>()
const activeProjectName = ref('')
const libraryLoading = ref(false)
const savingProject = ref(false)
const nameDialogOpen = ref(false)
const nameDialogMode = ref<'save' | 'rename'>('save')
const nameDialogInitial = ref('')
const namingProjectId = ref<string>()
let unlistenDrop: (() => void) | undefined
const generationSteps = ['读取字段结构', '计算本地统计', '规划图表组合', '生成可视化配置']
const builtReport = computed(() => dataset.value && reportSpec.value ? buildReport(dataset.value, reportSpec.value) : undefined)
const columnKinds = Object.entries(COLUMN_KIND_LABELS) as [ColumnKind, string][]
const activeSheet = computed(() => workbook.value?.sheets[sheetIndex.value])
const toolbarLabel = computed(() => stage.value === 'library' ? '返回 AI 办公' : '返回图表列表')

function handleToolbarBack() {
  if (props.initialDataset && stage.value === 'prepare') { emit('back'); return }
  if (stage.value === 'library') emit('back')
  else resetAll('library')
}

function formatSavedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

async function refreshLibrary() {
  libraryLoading.value = true
  try { savedProjects.value = await listSavedChartProjects() }
  catch { feedback.notify('已保存图表读取失败', 'warning') }
  finally { libraryLoading.value = false }
}

function startNewChart() {
  resetAll('import')
}

async function openSavedProject(id: string) {
  libraryLoading.value = true
  try {
    const project = await getSavedChartProject(id)
    if (!project) { feedback.notify('该图表已不存在', 'warning'); await refreshLibrary(); return }
    workbook.value = undefined
    dataset.value = structuredClone(project.dataset)
    reportSpec.value = structuredClone(project.reportSpec)
    originalSpec.value = structuredClone(project.reportSpec)
    activeProjectId.value = project.id
    activeProjectName.value = project.title
    deletedKpis.value = []
    generationNotice.value = `已打开保存于 ${formatSavedAt(project.updatedAt)} 的图表，可调整字段后重新规划。`
    stage.value = 'prepare'
  } catch { feedback.notify('已保存图表打开失败', 'warning') }
  finally { libraryLoading.value = false }
}

async function removeSavedProject(id: string, title: string) {
  if (!window.confirm(`删除已保存图表“${title}”？此操作不会删除原始表格。`)) return
  try {
    await deleteSavedChartProject(id)
    await refreshLibrary()
    feedback.notify('已保存图表已删除', 'success')
  } catch { feedback.notify('删除失败，请重试', 'warning') }
}

function requestProjectRename(project: SavedChartSummary) {
  nameDialogMode.value = 'rename'
  nameDialogInitial.value = project.title
  namingProjectId.value = project.id
  nameDialogOpen.value = true
}

function friendlyFileError(error: unknown) {
  const code = String(error)
  if (code.includes('unsupported_spreadsheet_type')) return '仅支持 XLSX、XLS 和 CSV 文件'
  if (code.includes('spreadsheet_too_large')) return '文件超过 50 MB，暂时无法处理'
  if (code.includes('spreadsheet_empty')) return '文件或工作表为空'
  return '文件读取失败，请确认文件未损坏'
}

function useWorkbook(value: ParsedWorkbook) {
  if (!value.sheets.length || value.sheets.every((sheet) => !sheet.rawRows.length)) throw new Error('spreadsheet_empty')
  workbook.value = value
  sheetIndex.value = Math.max(0, value.sheets.findIndex((sheet) => sheet.rawRows.length > 0))
  headerRow.value = value.sheets[sheetIndex.value]?.detectedHeaderRow ?? 0
  rebuildDataset()
  stage.value = 'prepare'
}

async function loadFile(file: File) {
  parsing.value = true
  fileError.value = ''
  try { useWorkbook(await parseSpreadsheetFile(file)) }
  catch (error) { fileError.value = friendlyFileError(error) }
  finally { parsing.value = false }
}

async function loadNativePath(path: string) {
  parsing.value = true
  fileError.value = ''
  try {
    const payload = await readNativeSpreadsheet(path)
    useWorkbook(payload.fileName.toLowerCase().endsWith('.csv')
      ? parseWorkbookData(decodeBase64Utf8(payload.base64), payload.fileName, payload.sizeBytes, 'string')
      : parseWorkbookData(payload.base64, payload.fileName, payload.sizeBytes, 'base64'))
  } catch (error) { fileError.value = friendlyFileError(error) }
  finally { parsing.value = false }
}

function handleDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files[0]
  if (file) void loadFile(file)
}

function rebuildDataset() {
  if (!workbook.value) return
  dataset.value = createDataset(workbook.value, sheetIndex.value, headerRow.value)
  fieldError.value = ''
}

function selectSheet(index: number) {
  sheetIndex.value = index
  headerRow.value = workbook.value?.sheets[index]?.detectedHeaderRow ?? 0
  rebuildDataset()
}

function setColumnKind(key: string, kind: ColumnKind) {
  if (dataset.value) dataset.value = updateColumnKind(dataset.value, key, kind)
}

function renameColumn(key: string, value: string, input: HTMLInputElement) {
  if (!dataset.value) return
  try {
    dataset.value = renameDatasetColumn(dataset.value, key, value)
    fieldError.value = ''
  } catch (error) {
    const code = String(error)
    fieldError.value = code.includes('duplicate')
      ? '字段名称不能重复'
      : code.includes('too_long') ? '字段名称最多 80 个字符' : '字段名称不能为空'
    input.value = dataset.value.columns.find((column) => column.key === key)?.label ?? key
  }
}

async function requestGeneration() {
  if (!dataset.value || !dataset.value.rows.length) { feedback.notify('所选工作表没有可用数据', 'warning'); return }
  if (!hasChartableColumns(createDataProfile(dataset.value))) { feedback.notify('没有可用于数值分析或分类统计的字段', 'warning'); return }
  if (hasApiKey.value && !settings.settings.aiPrivacyNoticeDismissed && !sessionPrivacyAccepted.value) {
    privacyOpen.value = true
    return
  }
  await generateReport()
}

async function acceptPrivacy(neverShowAgain: boolean) {
  privacyOpen.value = false
  sessionPrivacyAccepted.value = true
  if (neverShowAgain) await settings.dismissAiPrivacyNotice()
  await generateReport()
}

async function generateReport() {
  if (!dataset.value) return
  stage.value = 'generating'
  generationStep.value = 0
  generationNotice.value = ''
  const interval = window.setInterval(() => { generationStep.value = Math.min(generationStep.value + 1, generationSteps.length - 1) }, 620)
  const profile = createDataProfile(dataset.value)
  let spec = createLocalReportSpec(profile)
  if (hasApiKey.value) {
    try {
      let result = validateReportSpec(await generateAiChartPlan(settings.settings.aiModel, profile), profile)
      if (!result.success) {
        const firstReason = result.reason
        result = validateReportSpec(await generateAiChartPlan(settings.settings.aiModel, profile, firstReason), profile)
        if (result.success) generationNotice.value = 'AI 首次规划未通过校验，已自动修正。'
      }
      if (result.success && result.report) spec = result.report
      else generationNotice.value = `${reportValidationMessage(result.reason)}，已使用本地方案。`
    } catch (error) {
      generationNotice.value = `${aiErrorMessage(error)}，已根据数据结构自动生成图表。`
    }
  } else generationNotice.value = '尚未配置 AI 服务，已使用本地图表推荐。'
  window.clearInterval(interval)
  generationStep.value = generationSteps.length - 1
  reportSpec.value = structuredClone(spec)
  originalSpec.value = structuredClone(spec)
  deletedKpis.value = []
  window.setTimeout(() => { stage.value = 'report' }, 180)
}

function updateChart(index: number, patch: Partial<ChartSpec>) {
  if (!reportSpec.value) return
  reportSpec.value = { ...reportSpec.value, charts: reportSpec.value.charts.map((chart, chartIndex) => chartIndex === index ? { ...chart, ...patch } : chart) }
}

function moveChart(index: number, direction: -1 | 1) {
  if (!reportSpec.value) return
  const target = index + direction
  if (target < 0 || target >= reportSpec.value.charts.length) return
  const charts = [...reportSpec.value.charts]
  ;[charts[index], charts[target]] = [charts[target], charts[index]]
  reportSpec.value = { ...reportSpec.value, charts }
}

function deleteChart(index: number) {
  if (!reportSpec.value || reportSpec.value.charts.length <= 1) { feedback.notify('报告至少保留一张图表', 'warning'); return }
  reportSpec.value = { ...reportSpec.value, charts: reportSpec.value.charts.filter((_, chartIndex) => chartIndex !== index) }
}

function deleteKpi(index: number) {
  if (!reportSpec.value) return
  const kpi = reportSpec.value.kpis[index]
  if (!kpi) return
  deletedKpis.value = [...deletedKpis.value, { kpi, index }]
  reportSpec.value = { ...reportSpec.value, kpis: reportSpec.value.kpis.filter((_, kpiIndex) => kpiIndex !== index) }
}

function undoDeleteKpi() {
  if (!reportSpec.value) return
  const deleted = deletedKpis.value.at(-1)
  if (!deleted) return
  const kpis = [...reportSpec.value.kpis]
  kpis.splice(Math.min(deleted.index, kpis.length), 0, deleted.kpi)
  reportSpec.value = { ...reportSpec.value, kpis }
  deletedKpis.value = deletedKpis.value.slice(0, -1)
}

function restoreReport() {
  if (!originalSpec.value) return
  reportSpec.value = structuredClone(originalSpec.value)
  deletedKpis.value = []
}

function requestProjectSave() {
  if (!reportSpec.value) return
  nameDialogMode.value = 'save'
  nameDialogInitial.value = activeProjectName.value
  namingProjectId.value = activeProjectId.value
  nameDialogOpen.value = true
}

async function confirmProjectName(title: string) {
  if (nameDialogMode.value === 'rename') {
    if (!namingProjectId.value) return
    savingProject.value = true
    try {
      await renameSavedChartProject(namingProjectId.value, title)
      if (activeProjectId.value === namingProjectId.value) activeProjectName.value = title
      nameDialogOpen.value = false
      await refreshLibrary()
      feedback.notify('图表名称已更新', 'success')
    } catch { feedback.notify('图表重命名失败，请重试', 'warning') }
    finally { savingProject.value = false }
    return
  }
  await saveCurrentProject(title)
}

async function saveCurrentProject(title: string) {
  if (!dataset.value || !reportSpec.value) return
  savingProject.value = true
  try {
    const project = await saveChartProject({ id: activeProjectId.value, title, dataset: dataset.value, reportSpec: reportSpec.value })
    activeProjectId.value = project.id
    activeProjectName.value = project.title
    nameDialogOpen.value = false
    await refreshLibrary()
    feedback.notify('图表已保存，可从图表列表继续规划', 'success')
  } catch { feedback.notify('图表保存失败，请重试', 'warning') }
  finally { savingProject.value = false }
}

async function exportHtml() {
  if (!builtReport.value) return
  try {
    const path = await saveReportHtml(await exportReportHtml(builtReport.value), createReportFileName(builtReport.value))
    if (!path) return
    exportedPath.value = path
    feedback.notify('离线 HTML 报告已导出', 'success')
  } catch { feedback.notify('报告导出失败，请重试', 'warning') }
}

function resetAll(nextStage: 'library' | 'import' = 'library') {
  workbook.value = undefined
  dataset.value = undefined
  reportSpec.value = undefined
  originalSpec.value = undefined
  deletedKpis.value = []
  activeProjectId.value = undefined
  activeProjectName.value = ''
  nameDialogOpen.value = false
  namingProjectId.value = undefined
  exportedPath.value = ''
  fileError.value = ''
  fieldError.value = ''
  stage.value = nextStage
  if (nextStage === 'library') void refreshLibrary()
}

onMounted(async () => {
  await settings.initialize()
  if (props.initialDataset) {
    dataset.value = {
      ...props.initialDataset,
      columns: props.initialDataset.columns.map((column) => ({ ...column })),
      rows: props.initialDataset.rows.map((row) => ({ ...row })),
    }
    stage.value = 'prepare'
    generationNotice.value = '数据来自智能表格，可检查字段后直接规划图表。'
  } else await refreshLibrary()
  try { hasApiKey.value = (await getAiStatus()).hasApiKey } catch { hasApiKey.value = false }
  unlistenDrop = await onFileSystemDrop((paths) => { if (paths[0]) void loadNativePath(paths[0]) })
})
onUnmounted(() => unlistenDrop?.())
watch(stage, () => void nextTick(() => document.querySelector<HTMLElement>('.panel-content')?.scrollTo({ top: 0 })))
</script>

<template>
  <section class="smart-chart-studio" :data-stage="stage">
    <div class="studio-toolbar"><button type="button" @click="handleToolbarBack"><ArrowLeft :size="16" />{{ toolbarLabel }}</button><div v-if="!['library','import'].includes(stage)" class="steps" aria-label="生成进度"><span class="active">1 导入</span><ChevronRight :size="13" /><span :class="{ active: ['generating','report'].includes(stage) }">2 规划</span><ChevronRight :size="13" /><span :class="{ active: stage === 'report' }">3 报告</span></div></div>

    <div v-if="stage === 'library'" class="library-stage">
      <header class="library-heading"><div><span><BarChart3 :size="25" /></span><div><h2>已保存的图表</h2><p>打开已有图表继续调整字段和规划，或从新表格开始。</p></div></div><button type="button" class="new-chart" @click="startNewChart"><Plus :size="17" />新建图表</button></header>
      <div v-if="libraryLoading" class="library-status" role="status"><LoaderCircle class="spin" :size="20" />正在读取已保存图表…</div>
      <div v-else-if="savedProjects.length" class="saved-grid">
        <article v-for="project in savedProjects" :key="project.id" class="saved-card"><button type="button" class="saved-main" @click="openSavedProject(project.id)"><span class="saved-icon"><FileSpreadsheet :size="22" /></span><span class="saved-copy"><strong>{{ project.title }}</strong><small>{{ project.fileName }} · {{ project.sheetName }}</small><em>{{ project.rowCount }} 行 · {{ project.kpiCount }} 个统计 · {{ project.chartCount }} 张图表</em></span><span class="saved-time"><CalendarClock :size="13" />{{ formatSavedAt(project.updatedAt) }}</span><ChevronRight :size="18" /></button><div class="saved-actions"><button type="button" :aria-label="`重命名图表 ${project.title}`" @click="requestProjectRename(project)"><Pencil :size="14" /></button><button type="button" :aria-label="`删除已保存图表 ${project.title}`" @click="removeSavedProject(project.id, project.title)"><Trash2 :size="15" /></button></div></article>
      </div>
      <div v-else class="library-empty"><span><BarChart3 :size="32" /></span><h3>还没有保存的图表</h3><p>完成第一份报告后点击“保存图表”，下次可从这里直接继续规划。</p><button type="button" @click="startNewChart"><Plus :size="16" />导入第一份表格</button></div>
    </div>

    <div v-else-if="stage === 'import'" class="import-stage">
      <div class="import-heading"><span><FileSpreadsheet :size="26" /></span><div><h2>Excel 智能图表</h2><p>导入表格，在本机完成解析、统计与图表生成。</p></div></div>
      <label class="dropzone" :class="{ dragging }" @dragenter.prevent="dragging = true" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="handleDrop"><input type="file" accept=".xlsx,.xls,.csv" @change="($event.target as HTMLInputElement).files?.[0] && loadFile(($event.target as HTMLInputElement).files![0])" /><span><UploadCloud :size="31" /></span><strong>{{ parsing ? '正在读取文件…' : '拖入 Excel 或 CSV 文件' }}</strong><p>也可以点击选择文件，支持 .xlsx、.xls、.csv</p><em>最大 50 MB，超过 20 MB 会提示性能风险</em></label>
      <p v-if="fileError" class="inline-error" role="alert">{{ fileError }}</p>
      <div class="local-note"><ShieldCheck :size="18" /><span><strong>本地处理</strong> 文件不会上传；只有你主动启用 AI 规划时，才会发送脱敏后的数据概况。</span></div>
    </div>

    <div v-else-if="stage === 'prepare' && dataset" class="prepare-stage">
      <header class="file-summary"><span><Check :size="18" /></span><div><strong>{{ dataset.fileName }}</strong><small v-if="workbook">{{ (workbook.sizeBytes / 1024 / 1024).toFixed(2) }} MB · {{ workbook.sheets.length }} 个工作表 · {{ dataset.rows.length }} 行数据</small><small v-else>已保存图表 · {{ dataset.sheetName }} · {{ dataset.rows.length }} 行数据</small></div><em v-if="workbook && workbook.sizeBytes > SPREADSHEET_WARNING_BYTES">大文件，生成可能较慢</em></header>
      <section v-if="workbook" class="import-controls"><label><span>工作表</span><select :value="sheetIndex" @change="selectSheet(Number(($event.target as HTMLSelectElement).value))"><option v-for="(sheet, index) in workbook.sheets" :key="sheet.name" :value="index">{{ sheet.name }}（{{ sheet.rowCount }} 行）</option></select></label><label><span>表头所在行</span><select v-model.number="headerRow" @change="rebuildDataset"><option v-for="(_, index) in activeSheet?.rawRows.slice(0, 12)" :key="index" :value="index">第 {{ index + 1 }} 行{{ index === activeSheet?.detectedHeaderRow ? '（自动识别）' : '' }}</option></select></label></section>
      <section class="field-section"><header><div><h3>字段识别</h3><p>已识别 {{ dataset.columns.length }} 个字段，可修改名称和类型；字段名称不能重复。</p></div></header><p v-if="fieldError" class="inline-error" role="alert">{{ fieldError }}</p><div class="field-grid"><label v-for="column in dataset.columns" :key="column.sourceIndex" :class="{ low: column.confidence < .7 }"><span class="field-name"><input :value="column.label" :aria-label="`${column.label}字段名称`" maxlength="80" @change="renameColumn(column.key, ($event.target as HTMLInputElement).value, $event.target as HTMLInputElement)" /><small>{{ Math.round(column.confidence * 100) }}% 置信度</small></span><select :value="column.kind" :aria-label="`${column.label}字段类型`" @change="setColumnKind(column.key, ($event.target as HTMLSelectElement).value as ColumnKind)"><option v-for="([kind,label]) in columnKinds" :key="kind" :value="kind">{{ label }}</option></select></label></div></section>
      <section class="data-preview"><h3>数据预览</h3><div class="table-scroll"><table><thead><tr><th v-for="column in dataset.columns" :key="column.key">{{ column.label }}</th></tr></thead><tbody><tr v-for="(row,index) in dataset.rows.slice(0,5)" :key="index"><td v-for="column in dataset.columns" :key="column.key">{{ row[column.key] ?? '—' }}</td></tr></tbody></table></div></section>
      <div v-if="!hasApiKey" class="ai-guide"><Sparkles :size="18" /><span><strong>AI 服务尚未配置</strong><small>仍可使用本地规则生成图表；配置 DeepSeek 后可获得语义化标题和图表组合。</small></span><button type="button" @click="showSettings"><Settings :size="15" />去设置</button></div>
      <div class="generate-row"><button type="button" class="generate" @click="requestGeneration"><Sparkles :size="18" />{{ hasApiKey ? '生成智能图表' : '使用本地方案生成' }}</button></div>
    </div>

    <div v-else-if="stage === 'generating'" class="generating-stage" role="status"><span class="generation-orbit"><Sparkles :size="30" /></span><h2>{{ hasApiKey ? 'AI 正在规划图表' : '正在生成图表' }}</h2><div class="generation-list"><p v-for="(item,index) in generationSteps" :key="item" :class="{ done: index <= generationStep }"><span><Check v-if="index < generationStep" :size="14" /><LoaderCircle v-else-if="index === generationStep" class="spin" :size="14" /></span>{{ item }}</p></div></div>

    <div v-else-if="stage === 'report' && builtReport && reportSpec" class="report-stage">
      <header class="report-header"><div><input v-model="reportSpec.reportTitle" aria-label="报告标题" /><input v-model="reportSpec.reportSubtitle" aria-label="报告副标题" /></div><div class="report-actions"><button type="button" @click="restoreReport"><RotateCcw :size="15" />还原</button><button type="button" :disabled="savingProject" @click="requestProjectSave"><Save :size="15" />{{ activeProjectId ? '更新保存' : '保存图表' }}</button><button type="button" class="export" @click="exportHtml"><Download :size="16" />导出 HTML</button></div></header>
      <p v-if="generationNotice" class="fallback-notice">{{ generationNotice }}</p>
      <div class="source-line">{{ builtReport.source.fileName }} · {{ builtReport.source.sheetName }} · {{ builtReport.source.rowCount }} 条记录</div>
      <div v-if="deletedKpis.length" class="undo-kpi"><span>已删除 {{ deletedKpis.length }} 个统计卡片</span><button type="button" @click="undoDeleteKpi"><Undo2 :size="14" />撤销删除“{{ deletedKpis.at(-1)?.kpi.label }}”</button></div>
      <section v-if="builtReport.kpis.length" class="kpi-grid"><article v-for="(kpi,index) in builtReport.kpis" :key="kpi.id"><button type="button" :aria-label="`删除统计卡片 ${kpi.label}`" @click="deleteKpi(index)"><Trash2 :size="14" /></button><span>{{ kpi.label }}</span><strong>{{ kpi.displayValue }}</strong><small>{{ kpi.aggregation }} · {{ kpi.field }}</small></article></section>
      <section class="chart-grid"><EChartCard v-for="(chart,index) in builtReport.charts" :key="chart.spec.id" :chart="chart" :first="index === 0" :last="index === builtReport.charts.length - 1" @title="updateChart(index,{ title: $event })" @type="updateChart(index,{ type: $event as ChartType })" @delete="deleteChart(index)" @move="moveChart(index,$event)" /></section>
      <div v-if="exportedPath" class="export-result"><FolderOpen :size="17" /><span><strong>报告已保存</strong><small>{{ exportedPath }}</small></span><button type="button" @click="openReportHtml(exportedPath)">打开报告</button><button type="button" @click="openReportHtml(exportedPath,true)">打开位置</button></div>
    </div>

    <PrivacyDialog :open="privacyOpen" @cancel="privacyOpen = false" @confirm="acceptPrivacy" />
    <ChartNameDialog :open="nameDialogOpen" :mode="nameDialogMode" :initial-value="nameDialogInitial" :busy="savingProject" @cancel="nameDialogOpen = false" @confirm="confirmProjectName" />
  </section>
</template>

<style scoped>
.smart-chart-studio{display:grid;gap:13px;color:var(--color-text)}.studio-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px}.studio-toolbar>button{display:flex;align-items:center;gap:5px;padding:5px 9px;border:1px solid var(--color-border);border-radius:99px;color:var(--color-text-secondary);background:var(--color-surface);font-size:12px;cursor:pointer}.steps{display:flex;align-items:center;gap:6px;color:var(--color-text-muted);font-size:11px}.steps span.active{color:var(--color-ai-office);font-weight:650}.import-stage,.prepare-stage,.report-stage{display:grid;gap:13px}.import-heading{display:flex;align-items:center;justify-content:center;gap:11px;text-align:left}.import-heading>span{width:50px;height:50px;display:grid;place-items:center;border-radius:17px;color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 12%,transparent)}h2,h3,p{margin:0}.import-heading h2{font-size:21px}.import-heading p{margin-top:3px;color:var(--color-text-muted);font-size:13px}.dropzone{min-height:300px;display:grid;place-items:center;align-content:center;gap:8px;border:1.5px dashed color-mix(in srgb,var(--color-ai-office) 45%,var(--color-border));border-radius:22px;text-align:center;background:linear-gradient(150deg,color-mix(in srgb,var(--color-ai-office) 7%,var(--color-surface)),var(--color-surface-soft));cursor:pointer;transition:border-color 160ms,transform 160ms,background 160ms}.dropzone.dragging{transform:scale(.992);border-color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 11%,var(--color-surface))}.dropzone input{position:absolute;width:1px;height:1px;overflow:hidden;opacity:0}.dropzone>span{width:62px;height:62px;display:grid;place-items:center;border-radius:21px;color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 12%,transparent)}.dropzone strong{font-size:17px}.dropzone p{color:var(--color-text-secondary);font-size:13px}.dropzone em{color:var(--color-text-muted);font-size:11px;font-style:normal}.local-note,.ai-guide,.export-result{display:flex;align-items:center;gap:9px;padding:10px 12px;border-radius:12px;color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 7%,var(--color-surface))}.local-note span{color:var(--color-text-secondary);font-size:12px}.local-note strong{color:var(--color-text)}.inline-error{padding:9px 11px;border-radius:9px;color:#b75a55;background:color-mix(in srgb,#d16b63 10%,transparent);font-size:12px}.file-summary{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;padding:10px 12px;border:1px solid var(--color-border-subtle);border-radius:12px;background:var(--color-surface-soft)}.file-summary>span{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;color:#35836d;background:color-mix(in srgb,#58aa91 13%,transparent)}.file-summary div{display:grid;gap:2px}.file-summary strong{font-size:13px}.file-summary small{color:var(--color-text-muted);font-size:11px}.file-summary em{color:#a46b20;font-size:11px;font-style:normal}.import-controls{display:grid;grid-template-columns:1fr 1fr;gap:10px}.import-controls label{display:grid;gap:5px}.import-controls label>span{font-size:12px;font-weight:650}.import-controls select,.field-grid select{min-height:36px;padding:6px 8px;border:1px solid var(--color-border);border-radius:9px;color:var(--color-text);background:var(--color-surface-soft)}.field-section,.data-preview{display:grid;gap:8px}.field-section header h3,.data-preview h3{font-size:14px}.field-section header p{margin-top:2px;color:var(--color-text-muted);font-size:11px}.field-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.field-grid label{display:grid;grid-template-columns:minmax(0,1fr) 92px;align-items:center;gap:6px;padding:8px;border:1px solid var(--color-border-subtle);border-radius:10px;background:var(--color-surface)}.field-grid label.low{border-color:color-mix(in srgb,#d79b57 34%,var(--color-border))}.field-grid label>span{min-width:0;display:grid;gap:2px}.field-grid strong,.field-grid small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.field-grid strong{font-size:12px}.field-grid small{color:var(--color-text-muted);font-size:10px}.field-grid select{min-width:0;min-height:32px;font-size:11px}.table-scroll{max-height:142px;overflow:auto;border:1px solid var(--color-border-subtle);border-radius:10px}table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:11px}th,td{max-width:180px;padding:7px 9px;overflow:hidden;border-bottom:1px solid var(--color-border-subtle);text-align:left;text-overflow:ellipsis}th{position:sticky;top:0;color:var(--color-text-secondary);background:var(--color-surface-soft)}.ai-guide span,.export-result span{min-width:0;flex:1;display:grid;gap:2px}.ai-guide strong,.export-result strong{color:var(--color-text);font-size:12px}.ai-guide small,.export-result small{overflow:hidden;color:var(--color-text-muted);font-size:11px;text-overflow:ellipsis;white-space:nowrap}.ai-guide button,.export-result button{display:flex;align-items:center;gap:4px;padding:5px 9px;border:1px solid color-mix(in srgb,var(--color-ai-office) 25%,var(--color-border));border-radius:99px;color:var(--color-ai-office);background:var(--color-surface);font-size:11px;cursor:pointer}.generate-row{display:flex;justify-content:flex-end}.generate{min-height:40px;display:flex;align-items:center;gap:7px;padding:8px 18px;border:0;border-radius:99px;color:#fff;background:linear-gradient(135deg,var(--color-ai-office),#617ee7);font-size:13px;font-weight:650;box-shadow:0 8px 20px color-mix(in srgb,var(--color-ai-office) 24%,transparent);cursor:pointer}.generating-stage{min-height:500px;display:grid;place-items:center;align-content:center;gap:13px;text-align:center}.generation-orbit{width:72px;height:72px;display:grid;place-items:center;border-radius:26px;color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 12%,transparent);animation:pulse 1.6s ease-in-out infinite}.generating-stage h2{font-size:20px}.generation-list{width:260px;display:grid;gap:6px;text-align:left}.generation-list p{display:flex;align-items:center;gap:8px;color:var(--color-text-muted);font-size:12px}.generation-list p span{width:22px;height:22px;display:grid;place-items:center;border-radius:50%;background:var(--color-surface-soft)}.generation-list p.done{color:var(--color-text-secondary)}.generation-list p.done span{color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 11%,transparent)}.spin{animation:spin 1s linear infinite}.report-header{display:flex;align-items:center;justify-content:space-between;gap:12px}.report-header>div:first-child{min-width:0;display:grid;gap:2px}.report-header input{min-width:300px;padding:3px 5px;border:1px solid transparent;border-radius:6px;color:var(--color-text);background:transparent;outline:0}.report-header input:first-child{font-size:20px;font-weight:680}.report-header input:last-child{color:var(--color-text-muted);font-size:12px}.report-header input:hover,.report-header input:focus{border-color:var(--color-border);background:var(--color-surface-soft)}.report-actions{display:flex;gap:6px}.report-actions button{min-height:35px;display:flex;align-items:center;gap:5px;padding:6px 10px;border:1px solid var(--color-border);border-radius:99px;color:var(--color-text-secondary);background:var(--color-surface);font-size:11px;cursor:pointer}.report-actions .export{border-color:transparent;color:#fff;background:var(--color-ai-office)}.fallback-notice{padding:8px 10px;border-radius:9px;color:#8b681f;background:color-mix(in srgb,#d79b57 12%,transparent);font-size:11px}.source-line{color:var(--color-text-muted);font-size:11px}.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.kpi-grid article{min-width:0;padding:12px;border:1px solid var(--color-border-subtle);border-radius:13px;background:var(--color-surface)}.kpi-grid span,.kpi-grid small{display:block;overflow:hidden;color:var(--color-text-muted);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.kpi-grid strong{display:block;margin:6px 0 4px;font-size:20px}.chart-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.export-result{position:sticky;bottom:0;border:1px solid color-mix(in srgb,var(--color-ai-office) 17%,var(--color-border));box-shadow:0 -6px 18px rgb(28 36 49/6%)}button:focus-visible,select:focus-visible,input:focus-visible,.dropzone:focus-within{outline:2px solid var(--color-focus);outline-offset:2px}@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{50%{transform:translateY(-3px);box-shadow:0 12px 30px color-mix(in srgb,var(--color-ai-office) 20%,transparent)}}@media(max-width:760px){.field-grid{grid-template-columns:repeat(2,1fr)}.chart-grid{grid-template-columns:1fr}.kpi-grid{grid-template-columns:repeat(2,1fr)}.report-header{align-items:flex-start;flex-direction:column}.report-header input{min-width:0;width:100%}}@media(max-width:520px){.import-controls,.field-grid{grid-template-columns:1fr}.steps{display:none}}@media(prefers-reduced-motion:reduce){.dropzone,.generation-orbit,.spin{transition:none;animation:none}}
.library-stage{display:grid;gap:15px}.library-heading{display:flex;align-items:center;justify-content:space-between;gap:14px}.library-heading>div{display:flex;align-items:center;gap:11px}.library-heading>div>span{width:48px;height:48px;display:grid;place-items:center;border-radius:16px;color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 12%,transparent)}.library-heading h2{font-size:20px}.library-heading p{margin-top:3px;color:var(--color-text-muted);font-size:12px}.new-chart,.library-empty button{min-height:38px;display:flex;align-items:center;gap:6px;padding:7px 13px;border:0;border-radius:99px;color:#fff;background:var(--color-ai-office);font-size:12px;font-weight:650;cursor:pointer}.library-status,.library-empty{min-height:390px;display:grid;place-items:center;align-content:center;gap:9px;color:var(--color-text-muted);text-align:center}.library-empty>span{width:68px;height:68px;display:grid;place-items:center;border-radius:23px;color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 11%,transparent)}.library-empty h3{font-size:17px}.library-empty p{max-width:380px;color:var(--color-text-muted);font-size:12px;line-height:1.55}.library-empty button{margin-top:5px}.saved-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.saved-card{position:relative;min-width:0;border:1px solid var(--color-border-subtle);border-radius:15px;background:var(--color-surface);box-shadow:var(--shadow-sm);transition:transform var(--duration-fast),border-color var(--duration-fast)}.saved-card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--color-ai-office) 35%,var(--color-border))}.saved-main{width:100%;min-height:118px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-rows:1fr auto;align-items:center;gap:5px 11px;padding:14px 76px 14px 14px;border:0;color:inherit;text-align:left;background:transparent;cursor:pointer}.saved-icon{width:42px;height:42px;grid-row:1/3;display:grid;place-items:center;border-radius:13px;color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 10%,transparent)}.saved-copy{min-width:0;display:grid;gap:3px}.saved-copy strong,.saved-copy small,.saved-copy em{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.saved-copy strong{font-size:14px}.saved-copy small{color:var(--color-text-muted);font-size:11px}.saved-copy em{color:var(--color-text-secondary);font-size:10px;font-style:normal}.saved-time{display:flex;align-items:center;gap:4px;color:var(--color-text-muted);font-size:10px}.saved-main>svg{grid-column:3;grid-row:1/3;color:var(--color-text-muted)}.saved-actions{position:absolute;top:8px;right:8px;display:flex;gap:2px}.saved-actions button{width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:50%;color:var(--color-text-muted);background:transparent;cursor:pointer}.saved-actions button:hover{color:var(--color-ai-office);background:var(--color-surface-hover)}.saved-actions button:last-child:hover{color:#be6262}.field-name input{width:100%;min-width:0;padding:4px 5px;border:1px solid transparent;border-radius:7px;color:var(--color-text);background:transparent;font-size:12px;font-weight:650;outline:0}.field-name input:hover,.field-name input:focus{border-color:var(--color-border);background:var(--color-surface-soft)}.undo-kpi{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:10px;color:var(--color-text-secondary);background:var(--color-surface-soft);font-size:11px}.undo-kpi button{display:flex;align-items:center;gap:5px;padding:5px 9px;border:1px solid var(--color-border);border-radius:99px;color:var(--color-ai-office);background:var(--color-surface);font-size:11px;cursor:pointer}.kpi-grid article{position:relative}.kpi-grid article>button{position:absolute;top:7px;right:7px;width:26px;height:26px;display:grid;place-items:center;border:0;border-radius:50%;color:var(--color-text-muted);background:transparent;cursor:pointer;opacity:0;transition:opacity var(--duration-fast),background var(--duration-fast)}.kpi-grid article:hover>button,.kpi-grid article>button:focus-visible{opacity:1}.kpi-grid article>button:hover{color:#be6262;background:var(--color-surface-hover)}.report-actions button:disabled{opacity:.48;cursor:not-allowed}@media(max-width:760px){.saved-grid{grid-template-columns:1fr}}@media(max-width:520px){.library-heading{align-items:flex-start;flex-direction:column}.new-chart{align-self:stretch;justify-content:center}}@media(prefers-reduced-motion:reduce){.saved-card:hover{transform:none}}
</style>
