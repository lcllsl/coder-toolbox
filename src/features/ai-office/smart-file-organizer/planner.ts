import type { AiDimension, AiFileClassificationItem, ClassificationDictionary, FileAiMeta, FileMeta, FileMovePlan, FileOrganizeRule } from './types'

const FILE_TYPE_MAP: Record<string, string> = {
  '.doc': 'Word', '.docx': 'Word', '.xls': 'Excel', '.xlsx': 'Excel', '.csv': 'Excel',
  '.ppt': 'PowerPoint', '.pptx': 'PowerPoint', '.pdf': 'PDF', '.txt': 'Text', '.md': 'Text',
}
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const AI_RULES = new Set<AiDimension>(['department', 'person', 'project', 'documentType', 'topic'])

export function isAiRule(type: FileOrganizeRule['type']): type is AiDimension {
  return AI_RULES.has(type as AiDimension)
}

export function mapFileType(extension: string): string {
  return FILE_TYPE_MAP[extension.toLowerCase()] ?? 'Other'
}

export function sanitizeDirectoryName(value: string): string {
  let clean = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 80)
  if (!clean || clean === '.' || clean === '..') clean = '待确认'
  if (RESERVED.test(clean)) clean = `_${clean}`
  return clean
}

export function isOfficeTemporaryFile(name: string, extension: string): boolean {
  return name.startsWith('~$') || ['.tmp', '.temp'].includes(extension.toLowerCase()) || name.startsWith('.')
}

export function toAiMeta(file: FileMeta): FileAiMeta {
  return { id: file.id, name: file.name, extension: file.extension, parentFolder: file.parentFolderName || undefined, createdAt: file.createdAt, modifiedAt: file.modifiedAt, size: file.size }
}

function timePart(file: FileMeta, rule: FileOrganizeRule): string | null {
  const raw = file[rule.source ?? 'modifiedAt']
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return null
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  if (rule.type === 'year') return year
  if (rule.type === 'quarter') return `Q${Math.floor(date.getMonth() / 3) + 1}`
  if (rule.type === 'month') return month
  return day
}

export function buildTargetDirectory(file: FileMeta, rules: FileOrganizeRule[], classification?: AiFileClassificationItem): string[] {
  return rules.filter((rule) => rule.enabled).sort((a, b) => a.order - b.order).map((rule) => {
    if (rule.type === 'fileType') return mapFileType(file.extension)
    if (isAiRule(rule.type)) return sanitizeDirectoryName(classification?.categories[rule.type] ?? '待确认')
    return sanitizeDirectoryName(timePart(file, rule) ?? '待确认')
  })
}

export function buildMovePlan(files: FileMeta[], rules: FileOrganizeRule[], classifications: AiFileClassificationItem[]): FileMovePlan[] {
  const byId = new Map(classifications.map((item) => [item.fileId, item]))
  const targets = new Set<string>()
  return files.map((file) => {
    const classification = byId.get(file.id)
    const targetSegments = buildTargetDirectory(file, rules, classification)
    const needsConfirmation = targetSegments.includes('待确认') || classification?.confidence === 'low'
    const normalizedTarget = targetSegments.join('/')
    const current = file.relativeParent.replaceAll('\\', '/')
    const unchanged = normalizedTarget === current
    const targetKey = `${normalizedTarget}/${file.name}`.toLocaleLowerCase()
    const conflict = targets.has(targetKey)
    targets.add(targetKey)
    return {
      fileId: file.id, sourcePath: file.absolutePath, fileName: file.name, currentDirectory: current || '根目录', targetSegments,
      classification: classification?.categories ?? {}, confidence: classification?.confidence, reason: classification?.reason,
      selected: !needsConfirmation && !unchanged, status: unchanged ? 'unchanged' : needsConfirmation ? 'needs_confirmation' : conflict ? 'conflict' : 'ready',
    }
  })
}

export function normalizeDictionaryText(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))].slice(0, 200)
}

export function validateClassificationDictionary(value: string | null | undefined, dimension: AiDimension, dictionaries: ClassificationDictionary): boolean {
  if (value == null) return true
  const allowed = dictionaries[dimension]
  return !allowed?.length || allowed.includes(value)
}
