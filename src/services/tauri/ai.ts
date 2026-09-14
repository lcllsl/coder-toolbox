import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'

import type { DataProfile } from '@/features/ai-office/smart-chart/types'
import type { SmartTableSchema, SmartTableSourceBlock } from '@/features/ai-office/smart-table/types'
import { isTauriRuntime } from './runtime'

export interface AiStatus {
  provider: 'deepseek'
  hasApiKey: boolean
  models: string[]
}

export interface NativeSpreadsheetFile {
  fileName: string
  sizeBytes: number
  base64: string
}

const DEFAULT_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro']

export async function getAiStatus(): Promise<AiStatus> {
  if (!isTauriRuntime()) return { provider: 'deepseek', hasApiKey: false, models: DEFAULT_MODELS }
  return invoke<AiStatus>('ai_status')
}

export async function saveAiApiKey(apiKey: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error('ai_secure_storage_unavailable')
  await invoke('ai_save_api_key', { apiKey })
}

export async function deleteAiApiKey(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('ai_delete_api_key')
}

export async function testAiConnection(model: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error('ai_native_runtime_required')
  await invoke('ai_test_connection', { model })
}

export async function generateAiChartPlan(model: string, profile: DataProfile, validationReason?: string): Promise<unknown> {
  if (!isTauriRuntime()) throw new Error('ai_api_key_missing')
  return invoke<unknown>('ai_generate_chart_plan', { model, profile, validationReason })
}

export async function detectSmartTableSchema(
  model: string,
  sourceSample: string,
  targetDescription: string,
  templateName: string,
  validationReason?: string,
): Promise<unknown> {
  if (!isTauriRuntime()) throw new Error('ai_api_key_missing')
  return invoke<unknown>('ai_detect_table_schema', { model, sourceSample, targetDescription, templateName, validationReason })
}

export async function extractSmartTableRows(
  model: string,
  schema: SmartTableSchema,
  sourceBlocks: SmartTableSourceBlock[],
  validationReason?: string,
): Promise<unknown> {
  if (!isTauriRuntime()) throw new Error('ai_api_key_missing')
  return invoke<unknown>('ai_extract_table_rows', { model, schema, sourceBlocks, validationReason })
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export async function saveSmartTableFile(
  bytes: Uint8Array,
  suggestedName: string,
  format: 'xlsx' | 'csv',
): Promise<string | null> {
  if (!isTauriRuntime()) {
    const blob = new Blob([bytes], { type: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = suggestedName
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000)
    return suggestedName
  }
  const path = await save({
    title: format === 'xlsx' ? '导出智能表格 Excel' : '导出智能表格 CSV',
    defaultPath: suggestedName,
    filters: [{ name: format === 'xlsx' ? 'Excel 工作簿' : 'CSV 文件', extensions: [format] }],
  })
  if (!path) return null
  return invoke<string>('write_smart_table_export', { path, format, base64: bytesToBase64(bytes) })
}

export function smartTableExportErrorMessage(error: unknown): string {
  const code = String(error)
  if (code.includes('smart_table_export_path_invalid')) return '保存文件的扩展名与导出格式不一致'
  if (code.includes('smart_table_export_directory_missing')) return '选择的目标文件夹不存在'
  if (code.includes('smart_table_export_content_invalid')) return '生成的文件为空、格式无效或超过 24 MB'
  if (code.includes('smart_table_export_write_failed')) return '系统无法写入该位置，请检查文件是否被占用以及文件夹权限'
  if (code.includes('smart_table_export_format_invalid')) return '当前导出格式不受支持'
  return 'Excel 文件生成或系统保存对话框发生异常'
}

export async function readNativeSpreadsheet(path: string): Promise<NativeSpreadsheetFile> {
  if (!isTauriRuntime()) throw new Error('spreadsheet_native_read_unavailable')
  return invoke<NativeSpreadsheetFile>('read_spreadsheet_file', { path })
}

export async function saveReportHtml(html: string, suggestedName: string): Promise<string | null> {
  if (!isTauriRuntime()) {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = suggestedName
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000)
    return suggestedName
  }
  const path = await save({ title: '导出智能图表报告', defaultPath: suggestedName, filters: [{ name: 'HTML 报告', extensions: ['html'] }] })
  if (!path) return null
  return invoke<string>('write_report_html', { path, html })
}

export async function openReportHtml(path: string, reveal = false): Promise<void> {
  if (!isTauriRuntime() || !path) return
  await invoke('open_report_html', { path, reveal })
}

export function aiErrorMessage(error: unknown): string {
  const code = String(error)
  const messages: Record<string, string> = {
    ai_api_key_missing: '尚未配置 API Key',
    ai_api_key_rejected: 'API Key 无效或已失效',
    ai_model_unavailable: '所选模型暂时不可用',
    ai_request_timeout: 'AI 响应超时',
    ai_network_unavailable: '无法连接 AI 服务，请检查网络',
    ai_rate_limited: '请求较多，请稍后重试',
    ai_balance_insufficient: 'DeepSeek 账户余额不足',
    ai_local_storage_unavailable: '本机应用数据目录不可用',
    ai_local_storage_read_failed: '无法读取本机 API Key',
    ai_local_storage_write_failed: '无法保存本机 API Key',
    ai_native_runtime_required: '请在冒泡桌面应用中测试连接',
  }
  return Object.entries(messages).find(([key]) => code.includes(key))?.[1] ?? 'AI 服务暂时不可用'
}
