import type { DateFolderFormat } from '../types'

export interface PathConversionResult {
  value?: string
  error?: string
}

export function windowsToUnixPath(input: string, wsl = false): PathConversionResult {
  if (!input) return { error: '请输入 Windows 路径' }
  if (!wsl) return { value: input.replaceAll('\\', '/') }
  const match = /^([a-zA-Z]):[\\/]*(.*)$/.exec(input)
  if (!match?.[1]) return { error: 'WSL 转换需要包含盘符，例如 C:\\Users\\demo' }
  const remainder = (match[2] ?? '').replaceAll('\\', '/').replace(/^\/+/, '')
  return { value: `/mnt/${match[1].toLowerCase()}${remainder ? `/${remainder}` : ''}` }
}

export function unixToWindowsPath(input: string): PathConversionResult {
  if (!input) return { error: '请输入 WSL 路径' }
  const match = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(input)
  if (!match?.[1]) return { error: '仅支持可确定盘符的 /mnt/<drive>/ 路径' }
  const remainder = (match[2] ?? '').replaceAll('/', '\\')
  return { value: `${match[1].toUpperCase()}:\\${remainder}` }
}

export function fileNameFromPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  return normalized.split(/[\\/]/).pop() ?? normalized
}

export function parentPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (separatorIndex < 0) return ''
  if (separatorIndex === 2 && /^[a-zA-Z]:/.test(normalized)) return normalized.slice(0, 3)
  return normalized.slice(0, separatorIndex) || '/'
}

export function transferExpiryDate(addedAt: string, retentionDays = 7) {
  const timestamp = new Date(addedAt).getTime()
  if (!Number.isFinite(timestamp) || retentionDays < 1) return undefined
  return new Date(timestamp + retentionDays * 24 * 60 * 60 * 1000).toISOString()
}

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知大小'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = units[0]
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024
    unit = units[index]
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`
}

function dateParts(date: Date) {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return { year, month, day }
}

export function buildDateFolderName(format: DateFolderFormat, topic: string, date = new Date()): PathConversionResult {
  const { year, month, day } = dateParts(date)
  if (format === 'YYYYMMDD') return { value: `${year}${month}${day}` }
  const base = `${year}-${month}-${day}`
  if (format === 'YYYY-MM-DD') return { value: base }
  const normalizedTopic = topic.trim()
  if (!normalizedTopic) return { error: '请输入文件夹主题' }
  if (/[\\/:*?"<>|]/.test(normalizedTopic)) return { error: '主题不能包含路径分隔符或系统保留字符' }
  return { value: `${base}_${normalizedTopic}` }
}
