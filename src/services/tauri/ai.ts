import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'

import type { DataProfile } from '@/features/ai-office/smart-chart/types'
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

export async function generateAiChartPlan(model: string, profile: DataProfile): Promise<unknown> {
  if (!isTauriRuntime()) throw new Error('ai_api_key_missing')
  return invoke<unknown>('ai_generate_chart_plan', { model, profile })
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
    ai_secure_storage_unavailable: '系统安全存储暂不可用',
    ai_native_runtime_required: '请在冒泡桌面应用中测试连接',
  }
  return Object.entries(messages).find(([key]) => code.includes(key))?.[1] ?? 'AI 服务暂时不可用'
}
