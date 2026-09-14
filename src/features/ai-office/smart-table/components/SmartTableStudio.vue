<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronRight, ClipboardPaste, Copy, Download, FileSpreadsheet, Filter, LoaderCircle, Plus, RotateCcw, ShieldCheck, Sparkles, TableProperties, Trash2, TriangleAlert } from '@lucide/vue'

import { useFeedbackStore } from '@/app/stores/feedback'
import { useSettingsStore } from '@/app/stores/settings'
import { readClipboardText, writeClipboardText } from '@/services/tauri/clipboard'
import { aiErrorMessage, detectSmartTableSchema, extractSmartTableRows, getAiStatus, saveSmartTableFile, smartTableExportErrorMessage } from '@/services/tauri/ai'
import { showSettings } from '@/services/tauri/windows'
import { createSmartTableCsv, createSmartTableTsv, createSmartTableXlsx, safeExportName } from '../export'
import { protectSensitiveText } from '../privacy'
import { SMART_TABLE_COLUMN_LABELS, SMART_TABLE_COLUMN_TYPES, parseExtractionResult, parseSmartTableSchema, smartTableValidationReason } from '../schema'
import { createSourceBatches, splitSourceBlocks } from '../source'
import { SMART_TABLE_TEMPLATES, createTemplateSchema } from '../templates'
import { createSmartTableResult, removeDuplicateRows, removeEmptyRows, rowNeedsReview, smartTableToDataset } from '../table'
import type { PrivacyToken, SmartTable, SmartTableBatch, SmartTableColumn, SmartTableColumnType, SmartTableRow, SmartTableSchema, SmartTableSourceBlock, SmartTableTemplateId } from '../types'
import type { TabularDataset } from '../../smart-chart/types'
import SmartTablePrivacyDialog from './SmartTablePrivacyDialog.vue'

const emit = defineEmits<{ back: []; chart: [dataset: TabularDataset] }>()
type Step = 'input' | 'schema' | 'processing' | 'result'

const feedback = useFeedbackStore()
const settings = useSettingsStore()
const step = ref<Step>('input')
const rawText = ref('')
const targetDescription = ref('')
const selectedTemplate = ref<SmartTableTemplateId>('auto')
const privacyEnabled = ref(true)
const privacyOpen = ref(false)
const privacyAccepted = ref(false)
const hasApiKey = ref(false)
const busy = ref(false)
const errorMessage = ref('')
const schema = ref<SmartTableSchema>()
const table = ref<SmartTable>()
const sourceBlocks = ref<SmartTableSourceBlock[]>([])
const protectedBlocks = ref<SmartTableSourceBlock[]>([])
const privacyTokens = ref<PrivacyToken[]>([])
const batches = ref<SmartTableBatch[]>([])
const batchIndex = ref(0)
const extractedRows = ref<SmartTableRow[]>([])
const failedBatch = ref(false)
const stopped = ref(false)
const resultFilter = ref<'all' | 'review'>('all')
const selectedRowId = ref<string>()
const exportedPath = ref('')
const exportError = ref('')
const exportBusy = ref<'xlsx' | 'csv'>()
const operationStatus = ref('')
const operationDetail = ref('')
const elapsedSeconds = ref(0)
let statusStartedAt = 0
let statusTimer: ReturnType<typeof window.setInterval> | undefined

const templateName = computed(() => SMART_TABLE_TEMPLATES.find((item) => item.id === selectedTemplate.value)?.label ?? '自动识别')
const inputLengthWarning = computed(() => rawText.value.length > 50_000 && rawText.value.length <= 200_000)
const reviewCount = computed(() => table.value?.rows.filter(rowNeedsReview).length ?? 0)
const resultColumnError = computed(() => {
  if (!table.value) return ''
  const labels = table.value.columns.map((column) => column.label.trim())
  if (labels.some((label) => !label)) return '列名不能为空'
  if (new Set(labels.map((label) => label.toLocaleLowerCase())).size !== labels.length) return '列名不能重复'
  return ''
})
const visibleRows = computed(() => table.value?.rows.filter((row) => resultFilter.value === 'all' || rowNeedsReview(row)) ?? [])
const selectedSources = computed(() => {
  const row = table.value?.rows.find((item) => item.id === selectedRowId.value)
  if (!row || !table.value) return []
  const ids = new Set(row.sourceIds)
  return table.value.sourceBlocks.filter((block) => ids.has(block.id))
})
const progressLabel = computed(() => batches.value.length ? `${Math.min(batchIndex.value + 1, batches.value.length)} / ${batches.value.length}` : '0 / 0')
const elapsedHint = computed(() => {
  if (!busy.value) return operationDetail.value
  if (elapsedSeconds.value >= 45) return `${operationDetail.value} AI 响应时间较长，应用仍在等待；单次请求超时后会给出明确结果。`
  if (elapsedSeconds.value >= 15) return `${operationDetail.value} 大段文字或服务繁忙时可能需要几十秒，请保持窗口打开。`
  return operationDetail.value
})

function beginStatus(status: string, detail: string) {
  if (statusTimer !== undefined) window.clearInterval(statusTimer)
  statusStartedAt = Date.now()
  elapsedSeconds.value = 0
  operationStatus.value = status
  operationDetail.value = detail
  statusTimer = window.setInterval(() => { elapsedSeconds.value = Math.floor((Date.now() - statusStartedAt) / 1_000) }, 1_000)
}

function updateStatus(status: string, detail: string) {
  operationStatus.value = status
  operationDetail.value = detail
}

function endStatus(status: string, detail: string) {
  updateStatus(status, detail)
  if (statusTimer !== undefined) window.clearInterval(statusTimer)
  statusTimer = undefined
}

async function importClipboard() {
  const value = await readClipboardText()
  if (!value) { feedback.notify('当前剪贴板没有可导入的文本', 'warning'); return }
  rawText.value = value
  feedback.notify('已从当前剪贴板导入', 'success')
}

function prepareProtectedSources() {
  sourceBlocks.value = splitSourceBlocks(rawText.value)
  let tokens: PrivacyToken[] = []
  protectedBlocks.value = sourceBlocks.value.map((block) => {
    if (!privacyEnabled.value) return { ...block }
    const protectedValue = protectSensitiveText(block.text, tokens)
    tokens = protectedValue.tokens
    return { ...block, text: protectedValue.text }
  })
  privacyTokens.value = tokens
}

async function requestSchema() {
  prepareProtectedSources()
  const sample = protectedBlocks.value.map((block) => `[${block.id}] ${block.text}`).join('\n').slice(0, 50_000)
  let result: unknown
  try {
    updateStatus('正在请求 AI 识别字段', `已准备 ${sourceBlocks.value.length} 个原文片段，正在发送脱敏后的结构识别样本（第 1/2 次尝试）。`)
    result = await detectSmartTableSchema(settings.settings.aiModel, sample, targetDescription.value, templateName.value)
    updateStatus('已收到 AI 返回', '正在本机校验表格标题、字段名称和字段类型。')
    return parseSmartTableSchema(result)
  } catch (firstError) {
    if (String(firstError).includes('ai_')) throw firstError
    updateStatus('返回结构需要修正', '第一次返回的数据未通过本机校验，正在自动请求 AI 修正（第 2/2 次尝试）。')
    result = await detectSmartTableSchema(settings.settings.aiModel, sample, targetDescription.value, templateName.value, smartTableValidationReason(firstError))
    updateStatus('已收到修正结果', '正在本机再次校验字段结构。')
    return parseSmartTableSchema(result)
  }
}

async function detectSchema() {
  errorMessage.value = ''
  if (!rawText.value.trim()) { errorMessage.value = '请先粘贴或输入需要整理的信息'; return }
  if (rawText.value.length > 200_000) { errorMessage.value = '当前版本暂不支持一次整理超过 20 万字符的文本，请分批处理'; return }
  if (!hasApiKey.value) { errorMessage.value = 'AI 服务尚未配置。智能表格需要 AI 服务来识别和整理文本。'; return }
  if (!settings.settings.smartTablePrivacyNoticeDismissed && !privacyAccepted.value) { privacyOpen.value = true; return }
  busy.value = true
  beginStatus('正在准备文字', '正在切分原文并执行本地隐私保护，尚未向 AI 发送数据。')
  try {
    schema.value = await requestSchema()
    endStatus('字段结构识别成功', `已接收并验证 ${schema.value.columns.length} 个字段，完整记录尚未提取；请确认字段后继续。`)
    step.value = 'schema'
  } catch (error) {
    errorMessage.value = `${aiErrorMessage(error)}。暂时无法识别表格结构，可重试或手动创建字段。`
    endStatus('字段结构识别失败', '本次请求没有得到可用的本地字段结构，未开始提取记录。')
  } finally { busy.value = false }
}

async function acceptPrivacy(neverShowAgain: boolean) {
  privacyOpen.value = false
  privacyAccepted.value = true
  if (neverShowAgain) await settings.dismissSmartTablePrivacyNotice()
  await detectSchema()
}

function useManualSchema() {
  prepareProtectedSources()
  schema.value = createTemplateSchema(selectedTemplate.value, targetDescription.value)
  errorMessage.value = ''
  step.value = 'schema'
}

function updateSchemaColumn(index: number, patch: Partial<SmartTableColumn>) {
  if (!schema.value) return
  schema.value = { ...schema.value, columns: schema.value.columns.map((column, columnIndex) => columnIndex === index ? { ...column, ...patch } : column) }
}

function moveSchemaColumn(index: number, direction: -1 | 1) {
  if (!schema.value) return
  const target = index + direction
  if (target < 0 || target >= schema.value.columns.length) return
  const columns = [...schema.value.columns]
  ;[columns[index], columns[target]] = [columns[target], columns[index]]
  schema.value = { ...schema.value, columns }
}

function deleteSchemaColumn(index: number) {
  if (!schema.value || schema.value.columns.length <= 1) return
  schema.value = { ...schema.value, columns: schema.value.columns.filter((_, columnIndex) => columnIndex !== index) }
}

function addSchemaColumn() {
  if (!schema.value || schema.value.columns.length >= 12) return
  let index = schema.value.columns.length + 1
  let id = `column_${index}`
  while (schema.value.columns.some((column) => column.id === id)) { index += 1; id = `column_${index}` }
  schema.value = { ...schema.value, columns: [...schema.value.columns, { id, label: `新字段 ${index}`, type: 'text' }] }
}

async function requestExtractionBatch(batch: SmartTableBatch): Promise<SmartTableRow[]> {
  if (!schema.value) return []
  const validIds = new Set(batch.sourceBlocks.map((block) => block.id))
  try {
    updateStatus('正在提取记录', `第 ${batch.index + 1}/${batches.value.length} 批已发送，等待 AI 返回固定结构数据。`)
    const result = await extractSmartTableRows(settings.settings.aiModel, schema.value, batch.sourceBlocks)
    updateStatus('已收到本批数据', `正在本机校验第 ${batch.index + 1}/${batches.value.length} 批的字段、类型和原文来源。`)
    return parseExtractionResult(result, schema.value, validIds, privacyTokens.value)
  } catch (firstError) {
    if (String(firstError).includes('ai_')) throw firstError
    updateStatus('本批返回需要修正', `第 ${batch.index + 1}/${batches.value.length} 批未通过校验，正在自动修正重试（第 2/2 次尝试）。`)
    const result = await extractSmartTableRows(settings.settings.aiModel, schema.value, batch.sourceBlocks, 'extraction_schema_invalid')
    updateStatus('已收到本批修正数据', `正在本机再次校验第 ${batch.index + 1}/${batches.value.length} 批。`)
    return parseExtractionResult(result, schema.value, validIds, privacyTokens.value)
  }
}

async function continueExtraction() {
  busy.value = true
  failedBatch.value = false
  if (statusTimer === undefined && batchIndex.value < batches.value.length) {
    beginStatus('正在继续整理', `将从第 ${batchIndex.value + 1}/${batches.value.length} 批继续，已保留 ${extractedRows.value.length} 条记录。`)
  }
  while (batchIndex.value < batches.value.length && !stopped.value) {
    const batch = batches.value[batchIndex.value]
    try {
      const rows = await requestExtractionBatch(batch)
      extractedRows.value.push(...rows.map((row, index) => ({ ...row, id: `batch-${batch.index + 1}-${index + 1}-${row.id}` })))
      batchIndex.value += 1
      updateStatus('本批处理完成', `第 ${batch.index + 1}/${batches.value.length} 批已在本机验证，新增 ${rows.length} 条记录，累计 ${extractedRows.value.length} 条。`)
    } catch (error) {
      errorMessage.value = `${aiErrorMessage(error)}。第 ${batch.index + 1} 批整理失败。`
      endStatus('批次处理失败', `已保留前 ${batchIndex.value} 批的 ${extractedRows.value.length} 条本地记录，可重试、跳过或停止查看。`)
      failedBatch.value = true
      busy.value = false
      return
    }
  }
  busy.value = false
  if (!stopped.value || extractedRows.value.length) {
    endStatus('表格整理完成', `全部可用批次已处理，已在本机生成 ${extractedRows.value.length} 条记录。`)
    finishResult()
  }
}

async function startExtraction() {
  if (!schema.value) return
  const labels = schema.value.columns.map((column) => column.label.trim())
  if (labels.some((label) => !label) || new Set(labels.map((label) => label.toLocaleLowerCase())).size !== labels.length) {
    errorMessage.value = '字段名称不能为空或重复'
    return
  }
  batches.value = createSourceBatches(protectedBlocks.value)
  batchIndex.value = 0
  extractedRows.value = []
  stopped.value = false
  errorMessage.value = ''
  step.value = 'processing'
  beginStatus('正在开始整理', `共 ${batches.value.length} 批、${protectedBlocks.value.length} 个原文片段；即将请求第 1 批。`)
  await continueExtraction()
}

async function skipFailedBatch() {
  batchIndex.value += 1
  errorMessage.value = ''
  await continueExtraction()
}

function stopAndView() { stopped.value = true; finishResult() }

function finishResult() {
  if (!schema.value) return
  table.value = createSmartTableResult(schema.value, extractedRows.value, sourceBlocks.value)
  selectedRowId.value = table.value.rows[0]?.id
  step.value = 'result'
}

function editCell(row: SmartTableRow, column: SmartTableColumn, input: string) {
  const value = ['number', 'currency', 'percentage'].includes(column.type) && input.trim() !== '' && Number.isFinite(Number(input)) ? Number(input) : input || null
  row.values[column.id] = { ...row.values[column.id], value, warning: undefined, confidence: 'high' }
}

function deleteRow(id: string) {
  if (!table.value) return
  table.value.rows = table.value.rows.filter((row) => row.id !== id)
  if (selectedRowId.value === id) selectedRowId.value = table.value.rows[0]?.id
}

function deleteResultColumn(index: number) {
  if (!table.value || table.value.columns.length <= 1) return
  const id = table.value.columns[index].id
  table.value.columns.splice(index, 1)
  table.value.rows.forEach((row) => { delete row.values[id] })
}

function moveResultColumn(index: number, direction: -1 | 1) {
  if (!table.value) return
  const target = index + direction
  if (target < 0 || target >= table.value.columns.length) return
  ;[table.value.columns[index], table.value.columns[target]] = [table.value.columns[target], table.value.columns[index]]
}

function addResultColumn() {
  if (!table.value || table.value.columns.length >= 12) return
  const id = `added_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
  table.value.columns.push({ id, label: '新字段', type: 'text' })
  table.value.rows.forEach((row) => { row.values[id] = { value: null } })
}

function cleanDuplicates() {
  if (!table.value) return
  const before = table.value.rows.length
  table.value.rows = removeDuplicateRows(table.value.rows, table.value.columns.map((column) => column.id))
  feedback.notify(`已删除 ${before - table.value.rows.length} 条完全重复记录`, 'success')
}

function cleanEmptyRows() {
  if (!table.value) return
  const before = table.value.rows.length
  table.value.rows = removeEmptyRows(table.value.rows, table.value.columns.map((column) => column.id))
  feedback.notify(`已删除 ${before - table.value.rows.length} 条全空记录`, 'success')
}

async function copyTable() {
  if (!table.value) return
  if (resultColumnError.value) { feedback.notify(resultColumnError.value, 'warning'); return }
  await writeClipboardText(createSmartTableTsv(table.value))
  feedback.notify('表格已复制，可直接粘贴到 Excel、WPS 或飞书表格', 'success')
}

async function exportFile(format: 'xlsx' | 'csv') {
  if (!table.value) return
  if (resultColumnError.value) { feedback.notify(resultColumnError.value, 'warning'); return }
  exportError.value = ''
  exportBusy.value = format
  try {
    const bytes = format === 'xlsx' ? createSmartTableXlsx(table.value) : new TextEncoder().encode(createSmartTableCsv(table.value))
    exportedPath.value = await saveSmartTableFile(bytes, safeExportName(table.value.title, format), format) ?? ''
    if (exportedPath.value) feedback.notify(`${format.toUpperCase()} 已导出`, 'success')
  } catch (error) {
    exportError.value = smartTableExportErrorMessage(error)
    feedback.notify(`导出失败：${exportError.value}`, 'warning')
  } finally { exportBusy.value = undefined }
}

function openSmartChart() {
  if (!table.value) return
  if (resultColumnError.value) { feedback.notify(resultColumnError.value, 'warning'); return }
  emit('chart', smartTableToDataset(table.value))
}

function resetAll() {
  step.value = 'input'; schema.value = undefined; table.value = undefined; sourceBlocks.value = []; protectedBlocks.value = []
  privacyTokens.value = []; batches.value = []; extractedRows.value = []; batchIndex.value = 0; errorMessage.value = ''; exportedPath.value = ''; exportError.value = ''; exportBusy.value = undefined
  operationStatus.value = ''; operationDetail.value = ''; elapsedSeconds.value = 0
  if (statusTimer !== undefined) window.clearInterval(statusTimer)
  statusTimer = undefined
}

onMounted(async () => {
  await settings.initialize()
  try { hasApiKey.value = (await getAiStatus()).hasApiKey } catch { hasApiKey.value = false }
})
onUnmounted(() => { if (statusTimer !== undefined) window.clearInterval(statusTimer) })
</script>

<template>
  <section class="smart-table-studio" :data-step="step">
    <div class="toolbar"><button type="button" @click="step === 'input' ? emit('back') : resetAll()"><ArrowLeft :size="16" />{{ step === 'input' ? '返回 AI 办公' : '重新整理' }}</button><div class="steps" aria-label="整理进度"><span :class="{ active: step === 'input' }">1 输入</span><ChevronRight :size="13" /><span :class="{ active: step === 'schema' || step === 'processing' }">2 结构</span><ChevronRight :size="13" /><span :class="{ active: step === 'result' }">3 结果</span></div></div>

    <div v-if="step === 'input'" class="input-stage">
      <header class="page-heading"><span><TableProperties :size="27" /></span><div><h2>智能表格</h2><p>把聊天记录、名单、事项或其他文字整理成结构化数据。</p></div></header>
      <label class="text-field"><span>原始信息</span><textarea v-model="rawText" maxlength="200000" placeholder="把聊天记录、名单、事项或其他文字粘贴到这里" /><small :class="{ warn: inputLengthWarning }">{{ rawText.length.toLocaleString() }} / 200,000 字符<span v-if="inputLengthWarning"> · 内容较长，将分批整理</span></small></label>
      <div class="input-actions"><button type="button" @click="importClipboard"><ClipboardPaste :size="15" />从剪贴板导入</button></div>
      <label class="text-field compact"><span>你希望整理成什么？（可选）</span><input v-model="targetDescription" maxlength="1000" placeholder="例如：姓名、部门、电话、事项、截止日期" /></label>
      <section class="templates"><h3>快速模板</h3><div><button v-for="template in SMART_TABLE_TEMPLATES" :key="template.id" type="button" :class="{ active: selectedTemplate === template.id }" @click="selectedTemplate = template.id">{{ template.label }}</button></div></section>
      <label class="privacy-toggle"><span><ShieldCheck :size="18" /><span><strong>隐私保护模式</strong><small>手机号、邮箱、证件号和 Token 会先在本机匿名化</small></span></span><input v-model="privacyEnabled" type="checkbox" /></label>
      <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>
      <div v-if="operationStatus" class="operation-status" :class="{ active: busy }" role="status" aria-live="polite"><span><LoaderCircle v-if="busy" class="spin" :size="17" /><Check v-else-if="operationStatus.includes('成功')" :size="17" /><TriangleAlert v-else :size="17" /></span><div><strong>{{ operationStatus }}<em v-if="busy">{{ elapsedSeconds }} 秒</em></strong><p>{{ elapsedHint }}</p></div></div>
      <div v-if="!hasApiKey" class="ai-missing"><span><TriangleAlert :size="17" />AI 服务尚未配置，智能表格需要 AI 服务完成识别和提取。</span><button type="button" @click="showSettings">去设置</button></div>
      <div class="primary-row"><button v-if="errorMessage.includes('手动创建')" type="button" class="secondary" @click="useManualSchema">手动创建字段</button><button type="button" class="primary" :disabled="busy || !rawText.trim() || !hasApiKey" @click="detectSchema"><LoaderCircle v-if="busy" class="spin" :size="16" /><Sparkles v-else :size="16" />{{ busy ? '正在识别结构' : '识别表格结构' }}</button></div>
    </div>

    <div v-else-if="step === 'schema' && schema" class="schema-stage">
      <header class="section-heading"><div><h2>确认表格结构</h2><p>AI 只识别了字段，确认后才会正式提取 {{ sourceBlocks.length }} 个原文片段。</p></div></header>
      <label class="title-field"><span>表格标题</span><input v-model="schema.tableTitle" maxlength="100" /></label>
      <div class="schema-columns">
        <article v-for="(column,index) in schema.columns" :key="column.id"><div class="reorder"><button type="button" aria-label="上移字段" :disabled="index === 0" @click="moveSchemaColumn(index,-1)"><ArrowUp :size="13" /></button><button type="button" aria-label="下移字段" :disabled="index === schema.columns.length - 1" @click="moveSchemaColumn(index,1)"><ArrowDown :size="13" /></button></div><label><span>字段名称</span><input :value="column.label" maxlength="80" @input="updateSchemaColumn(index,{ label: ($event.target as HTMLInputElement).value })" /></label><label><span>字段类型</span><select :value="column.type" @change="updateSchemaColumn(index,{ type: ($event.target as HTMLSelectElement).value as SmartTableColumnType })"><option v-for="type in SMART_TABLE_COLUMN_TYPES" :key="type" :value="type">{{ SMART_TABLE_COLUMN_LABELS[type] }}</option></select></label><label class="description"><span>说明</span><input :value="column.description" maxlength="160" placeholder="可选" @input="updateSchemaColumn(index,{ description: ($event.target as HTMLInputElement).value })" /></label><button type="button" class="delete" :disabled="schema.columns.length <= 1" :aria-label="`删除字段 ${column.label}`" @click="deleteSchemaColumn(index)"><Trash2 :size="15" /></button></article>
      </div>
      <button type="button" class="add-column" :disabled="schema.columns.length >= 12" @click="addSchemaColumn"><Plus :size="15" />添加字段</button>
      <div v-if="operationStatus" class="operation-status success" role="status"><span><Check :size="17" /></span><div><strong>{{ operationStatus }}</strong><p>{{ operationDetail }}</p></div></div>
      <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>
      <div class="primary-row"><button type="button" class="secondary" @click="step = 'input'">返回修改</button><button type="button" class="primary" @click="startExtraction"><Sparkles :size="16" />开始整理</button></div>
    </div>

    <div v-else-if="step === 'processing'" class="processing-stage">
      <span class="processing-icon"><LoaderCircle v-if="busy" class="spin" :size="31" /><TriangleAlert v-else-if="failedBatch" :size="31" /><Check v-else :size="31" /></span><h2>{{ failedBatch ? '部分信息整理失败' : operationStatus }}</h2><p>第 {{ progressLabel }} 批 · 已验证 {{ extractedRows.length }} 条记录 · {{ elapsedSeconds }} 秒</p><div class="progress" role="progressbar" :aria-valuenow="batchIndex" aria-valuemin="0" :aria-valuemax="batches.length"><span :style="{ width: `${batches.length ? batchIndex / batches.length * 100 : 0}%` }" /></div><p class="processing-detail" aria-live="polite">{{ elapsedHint }}</p>
      <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>
      <div v-if="failedBatch" class="failure-actions"><button type="button" @click="continueExtraction"><RotateCcw :size="15" />重试当前批</button><button type="button" @click="skipFailedBatch">跳过当前批</button><button type="button" :disabled="!extractedRows.length" @click="stopAndView">停止并查看已有结果</button></div>
      <button v-else-if="!busy && extractedRows.length" type="button" class="primary" @click="finishResult"><Check :size="15" />查看整理结果</button>
    </div>

    <div v-else-if="step === 'result' && table" class="result-stage">
      <header class="result-heading"><div><span><Check :size="20" /></span><div><h2>{{ table.title }}</h2><p>已整理 {{ table.rows.length }} 条记录 · {{ table.columns.length }} 个字段 · {{ reviewCount }} 项需要确认</p></div></div><button type="button" class="add-column" @click="addResultColumn"><Plus :size="14" />新增空列</button></header>
      <div class="result-tools"><div class="filters"><button type="button" :class="{ active: resultFilter === 'all' }" @click="resultFilter = 'all'"><Filter :size="13" />全部</button><button type="button" :class="{ active: resultFilter === 'review' }" @click="resultFilter = 'review'"><TriangleAlert :size="13" />需要确认 ({{ reviewCount }})</button></div><div><button type="button" @click="cleanDuplicates">删除重复记录</button><button type="button" @click="cleanEmptyRows">删除全空记录</button></div></div>
      <div class="result-layout" :class="{ 'with-source': selectedSources.length }"><div class="table-scroll"><table><thead><tr><th class="status-col">状态</th><th v-for="(column,index) in table.columns" :key="column.id"><div><input v-model="column.label" maxlength="80" :aria-label="`${column.label}列名`" /><span><button type="button" :disabled="index === 0" aria-label="向左移动列" @click="moveResultColumn(index,-1)"><ArrowLeft :size="12" /></button><button type="button" :disabled="index === table.columns.length - 1" aria-label="向右移动列" @click="moveResultColumn(index,1)"><ChevronRight :size="12" /></button><button type="button" aria-label="删除列" @click="deleteResultColumn(index)"><Trash2 :size="12" /></button></span></div></th><th class="row-action">操作</th></tr></thead><tbody><tr v-for="row in visibleRows" :key="row.id" :class="{ selected: selectedRowId === row.id }" @click="selectedRowId = row.id"><td class="status-col"><button v-if="rowNeedsReview(row)" type="button" class="review-dot" title="需要确认" @click.stop="row.confirmed = true"><TriangleAlert :size="14" /></button><Check v-else :size="14" /></td><td v-for="column in table.columns" :key="column.id"><input :value="row.values[column.id]?.value ?? ''" :class="{ warning: row.values[column.id]?.warning }" @change="editCell(row,column,($event.target as HTMLInputElement).value)" /></td><td class="row-action"><button type="button" aria-label="删除行" @click.stop="deleteRow(row.id)"><Trash2 :size="14" /></button></td></tr></tbody></table><p v-if="!visibleRows.length" class="empty-result">当前筛选下没有记录。</p></div><aside v-if="selectedSources.length" class="source-panel"><h3>来源</h3><p v-for="source in selectedSources" :key="source.id"><small>{{ source.id }}</small>{{ source.text }}</p></aside></div>
      <p v-if="resultColumnError" class="inline-error" role="alert">{{ resultColumnError }}，修正后才能复制、导出或生成图表。</p>
      <p v-if="exportError" class="inline-error" role="alert">导出失败：{{ exportError }}</p>
      <p v-if="exportedPath" class="export-path">已保存：{{ exportedPath }}</p>
      <footer class="result-actions"><button type="button" @click="resetAll"><RotateCcw :size="15" />重新整理</button><button type="button" :disabled="!!resultColumnError || !!exportBusy" @click="copyTable"><Copy :size="15" />复制表格</button><button type="button" :disabled="!!resultColumnError || !!exportBusy" @click="exportFile('xlsx')"><LoaderCircle v-if="exportBusy === 'xlsx'" class="spin" :size="15" /><Download v-else :size="15" />{{ exportBusy === 'xlsx' ? '正在生成 Excel' : '导出 Excel' }}</button><button type="button" :disabled="!!resultColumnError || !!exportBusy" @click="exportFile('csv')"><LoaderCircle v-if="exportBusy === 'csv'" class="spin" :size="15" /><Download v-else :size="15" />{{ exportBusy === 'csv' ? '正在生成 CSV' : '导出 CSV' }}</button><button type="button" class="primary" :disabled="!table.rows.length || !!resultColumnError || !!exportBusy" @click="openSmartChart"><FileSpreadsheet :size="15" />生成智能图表</button></footer>
    </div>

    <SmartTablePrivacyDialog :open="privacyOpen" @cancel="privacyOpen = false" @confirm="acceptPrivacy" />
  </section>
</template>

<style scoped>
.smart-table-studio{display:grid;gap:14px;color:var(--color-text)}h2,h3,p{margin:0}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px}.toolbar>button,.input-actions button,.secondary,.add-column,.failure-actions button,.result-tools button,.result-actions>button{display:flex;align-items:center;justify-content:center;gap:5px;min-height:34px;padding:6px 10px;border:1px solid var(--color-border);border-radius:99px;color:var(--color-text-secondary);background:var(--color-surface);font-size:12px;cursor:pointer}.steps{display:flex;align-items:center;gap:6px;color:var(--color-text-muted);font-size:11px}.steps .active{color:var(--color-ai-office);font-weight:650}.input-stage,.schema-stage,.result-stage{display:grid;gap:13px}.page-heading{display:flex;align-items:center;gap:11px}.page-heading>span,.processing-icon{width:50px;height:50px;display:grid;place-items:center;border-radius:17px;color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 12%,transparent)}.page-heading h2{font-size:21px}.page-heading p,.section-heading p,.result-heading p{margin-top:3px;color:var(--color-text-muted);font-size:12px}.text-field,.title-field{display:grid;gap:6px}.text-field>span,.title-field>span,.schema-columns label>span{font-size:12px;font-weight:650}.text-field textarea{min-height:235px;resize:vertical}.text-field textarea,.text-field input,.title-field input,.schema-columns input,.schema-columns select{width:100%;padding:9px 10px;border:1px solid var(--color-border);border-radius:10px;color:var(--color-text);background:var(--color-surface-soft);font:inherit;outline:0}.text-field small{justify-self:end;color:var(--color-text-muted);font-size:10px}.text-field small.warn{color:#a46b20}.input-actions{display:flex;justify-content:flex-start;margin-top:-7px}.templates{display:grid;gap:7px}.templates h3{font-size:13px}.templates>div{display:flex;flex-wrap:wrap;gap:7px}.templates button,.filters button{padding:6px 10px;border:1px solid var(--color-border);border-radius:99px;color:var(--color-text-secondary);background:var(--color-surface);font-size:11px;cursor:pointer}.templates button.active,.filters button.active{border-color:color-mix(in srgb,var(--color-ai-office) 45%,var(--color-border));color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 9%,var(--color-surface))}.privacy-toggle{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:12px;background:var(--color-surface-soft)}.privacy-toggle>span{display:flex;align-items:center;gap:9px}.privacy-toggle>span>span{display:grid;gap:2px}.privacy-toggle strong{font-size:12px}.privacy-toggle small{color:var(--color-text-muted);font-size:10px}.privacy-toggle input{accent-color:var(--color-ai-office)}.ai-missing{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:10px;color:#8b681f;background:color-mix(in srgb,#d79b57 12%,transparent);font-size:11px}.ai-missing span{display:flex;align-items:center;gap:6px}.ai-missing button{border:0;color:var(--color-ai-office);background:transparent;cursor:pointer}.inline-error{padding:9px 11px;border-radius:9px;color:#b75a55;background:color-mix(in srgb,#d16b63 10%,transparent);font-size:12px}.primary-row{display:flex;justify-content:flex-end;gap:8px}.primary{display:flex;align-items:center;justify-content:center;gap:6px;min-height:38px;padding:7px 15px;border:0;border-radius:99px;color:#fff;background:var(--color-ai-office);font-size:12px;font-weight:650;cursor:pointer}.primary:disabled,button:disabled{opacity:.48;cursor:not-allowed}.section-heading h2{font-size:19px}.schema-columns{display:grid;gap:7px}.schema-columns article{display:grid;grid-template-columns:55px minmax(130px,1fr) 120px minmax(150px,1.4fr) 34px;align-items:end;gap:7px;padding:8px;border:1px solid var(--color-border-subtle);border-radius:11px;background:var(--color-surface)}.schema-columns label{display:grid;gap:4px}.reorder{display:flex;gap:3px}.reorder button,.schema-columns .delete,.result-layout button{width:27px;height:27px;display:grid;place-items:center;padding:0;border:0;border-radius:50%;color:var(--color-text-muted);background:var(--color-surface-soft);cursor:pointer}.processing-stage{min-height:480px;display:grid;place-items:center;align-content:center;gap:12px;text-align:center}.processing-stage h2{font-size:20px}.processing-stage>p{color:var(--color-text-muted);font-size:12px}.progress{width:min(420px,80%);height:7px;overflow:hidden;border-radius:99px;background:var(--color-surface-soft)}.progress span{display:block;height:100%;border-radius:inherit;background:var(--color-ai-office);transition:width 180ms}.failure-actions{display:flex;gap:8px}.result-heading,.result-heading>div,.result-tools,.result-tools>div,.result-actions{display:flex;align-items:center}.result-heading,.result-tools{justify-content:space-between;gap:10px}.result-heading>div{gap:9px}.result-heading>div>span{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;color:#357965;background:color-mix(in srgb,#58aa91 13%,transparent)}.result-heading h2{font-size:18px}.result-tools>div{gap:6px}.result-layout{display:grid;gap:10px}.result-layout.with-source{grid-template-columns:minmax(0,1fr) 250px}.table-scroll{max-height:430px;overflow:auto;border:1px solid var(--color-border-subtle);border-radius:11px}.table-scroll table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:11px}th,td{padding:6px 7px;border-bottom:1px solid var(--color-border-subtle);text-align:left}th{position:sticky;z-index:2;top:0;background:var(--color-surface-soft)}th>div{display:flex;align-items:center;justify-content:space-between;gap:4px}th input,td input{width:130px;min-width:90px;padding:5px 6px;border:1px solid transparent;border-radius:6px;color:var(--color-text);background:transparent;font:inherit;outline:0}th input{font-weight:650}th span{display:flex}th button{width:22px!important;height:22px!important}td input:hover,td input:focus,th input:hover,th input:focus{border-color:var(--color-border);background:var(--color-surface)}td input.warning{border-color:color-mix(in srgb,#d79b57 45%,var(--color-border));background:color-mix(in srgb,#d79b57 7%,transparent)}tr.selected td{background:color-mix(in srgb,var(--color-ai-office) 5%,transparent)}.status-col{width:44px;text-align:center}.review-dot{color:#b47a28!important}.row-action{width:42px;text-align:center}.source-panel{max-height:430px;overflow:auto;padding:12px;border:1px solid var(--color-border-subtle);border-radius:11px;background:var(--color-surface-soft)}.source-panel h3{margin-bottom:8px;font-size:13px}.source-panel p{display:grid;gap:3px;margin-bottom:8px;padding:8px;border-radius:8px;background:var(--color-surface);font-size:11px;line-height:1.5;white-space:pre-wrap}.source-panel small{color:var(--color-text-muted)}.empty-result{padding:30px;color:var(--color-text-muted);text-align:center;font-size:12px}.export-path{padding:8px 10px;border-radius:9px;color:#357965;background:color-mix(in srgb,#58aa91 10%,transparent);font-size:11px}.result-actions{justify-content:flex-end;flex-wrap:wrap;gap:7px}.result-actions .primary{border:0;color:#fff;background:var(--color-ai-office)}.spin{animation:spin 1s linear infinite}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--color-focus);outline-offset:2px}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:800px){.schema-columns article{grid-template-columns:48px 1fr 110px 34px}.schema-columns .description{grid-column:2/4}.result-layout.with-source{grid-template-columns:1fr}.source-panel{max-height:180px}}@media(prefers-reduced-motion:reduce){.spin{animation:none}.progress span{transition:none}}
.operation-status{display:flex;align-items:flex-start;gap:9px;padding:11px 12px;border:1px solid color-mix(in srgb,var(--color-ai-office) 22%,var(--color-border));border-radius:11px;background:color-mix(in srgb,var(--color-ai-office) 6%,var(--color-surface));font-size:11px}.operation-status>span{width:28px;height:28px;display:grid;flex:0 0 auto;place-items:center;border-radius:9px;color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 12%,transparent)}.operation-status>div{display:grid;gap:3px}.operation-status strong{display:flex;align-items:center;gap:8px;font-size:12px}.operation-status em{padding:2px 6px;border-radius:99px;color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 10%,transparent);font-size:10px;font-style:normal;font-variant-numeric:tabular-nums}.operation-status p{color:var(--color-text-muted);line-height:1.5}.operation-status.success>span{color:#357965;background:color-mix(in srgb,#58aa91 13%,transparent)}.processing-detail{max-width:520px;line-height:1.6}
</style>
