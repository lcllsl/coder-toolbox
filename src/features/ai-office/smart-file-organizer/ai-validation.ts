import { z } from 'zod'
import { isAiRule, validateClassificationDictionary } from './planner'
import type { AiDimension, AiFileClassificationItem, ClassificationDictionary } from './types'

const DIMENSIONS: AiDimension[] = ['department', 'person', 'project', 'documentType', 'topic']
const suspicious = /(?:[A-Za-z]:[\\/]|\.\.[\\/]|[\\/]{2}|\b(?:powershell|cmd\.exe|bash|sh)\b)/i
const resultSchema = z.object({
  version: z.literal(1),
  items: z.array(z.object({
    fileId: z.string().min(1),
    categories: z.object({
      department: z.string().nullable().optional(), person: z.string().nullable().optional(), project: z.string().nullable().optional(),
      documentType: z.string().nullable().optional(), topic: z.string().nullable().optional(),
    }).strict(),
    confidence: z.enum(['high', 'medium', 'low']),
    reason: z.string().max(240).optional(),
  }).strict()),
}).strict()

export function parseAiClassifications(raw: unknown, fileIds: Set<string>, enabledDimensions: AiDimension[], dictionaries: ClassificationDictionary): AiFileClassificationItem[] {
  const parsed = resultSchema.safeParse(raw)
  if (!parsed.success) throw new Error('file_classification_schema_invalid')
  const enabled = new Set(enabledDimensions)
  const seen = new Set<string>()
  return parsed.data.items.map((item) => {
    if (!fileIds.has(item.fileId) || seen.has(item.fileId)) throw new Error('file_classification_unknown_id')
    seen.add(item.fileId)
    const categories: AiFileClassificationItem['categories'] = {}
    let invalidAny = false
    for (const dimension of DIMENSIONS) {
      const value = item.categories[dimension]
      if (!enabled.has(dimension)) continue
      const invalid = !isAiRule(dimension) || !validateClassificationDictionary(value, dimension, dictionaries) || (value != null && suspicious.test(value))
      invalidAny ||= invalid
      categories[dimension] = invalid ? null : value ?? null
    }
    return { fileId: item.fileId, categories, confidence: invalidAny ? 'low' : item.confidence, reason: suspicious.test(item.reason ?? '') ? undefined : item.reason }
  })
}
