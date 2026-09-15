import { describe, expect, it } from 'vitest'
import { parseAiClassifications } from '@/features/ai-office/smart-file-organizer/ai-validation'
import { buildMovePlan, buildTargetDirectory, isOfficeTemporaryFile, mapFileType, normalizeDictionaryText, sanitizeDirectoryName, toAiMeta } from '@/features/ai-office/smart-file-organizer/planner'
import type { FileMeta, FileOrganizeRule } from '@/features/ai-office/smart-file-organizer/types'

const file: FileMeta = {
  id: 'file-00001', name: '财务部_预算.xlsx', extension: '.xlsx', absolutePath: '/Users/test/资料/财务部_预算.xlsx',
  parentFolderName: '资料', relativeParent: '', createdAt: new Date(2025, 0, 2).getTime(), modifiedAt: new Date(2026, 8, 14).getTime(), size: 128,
}

describe('smart file organizer core', () => {
  it('maps office extensions and recognizes temporary files', () => {
    expect(mapFileType('.XLSX')).toBe('Excel')
    expect(mapFileType('.zip')).toBe('Other')
    expect(isOfficeTemporaryFile('~$预算.docx', '.docx')).toBe(true)
    expect(isOfficeTemporaryFile('缓存.tmp', '.tmp')).toBe(true)
  })

  it('builds ordered local and AI directory segments from the selected time source', () => {
    const rules: FileOrganizeRule[] = [
      { id: '2', type: 'department', aiRequired: true, enabled: true, order: 1 },
      { id: '1', type: 'year', source: 'modifiedAt', aiRequired: false, enabled: true, order: 0 },
      { id: '3', type: 'fileType', aiRequired: false, enabled: true, order: 2 },
    ]
    expect(buildTargetDirectory(file, rules, { fileId: file.id, categories: { department: '财务部' }, confidence: 'high' })).toEqual(['2026', '财务部', 'Excel'])
  })

  it('sanitizes illegal and Windows-reserved directory names', () => {
    expect(sanitizeDirectoryName(' 项目/资料:* ')).toBe('项目_资料__')
    expect(sanitizeDirectoryName('CON')).toBe('_CON')
    expect(sanitizeDirectoryName('..')).toBe('待确认')
  })

  it('sends no absolute path to AI and normalizes dictionary lines', () => {
    expect(toAiMeta(file)).not.toHaveProperty('absolutePath')
    expect(JSON.stringify(toAiMeta(file))).not.toContain('/Users/test')
    expect(normalizeDictionaryText('财务部\n财务部\n 市场部 ')).toEqual(['财务部', '市场部'])
  })

  it('rejects unknown IDs and constrains dictionary values', () => {
    const valid = parseAiClassifications({ version: 1, items: [{ fileId: file.id, categories: { department: '财务部' }, confidence: 'high', reason: '文件名包含财务部' }] }, new Set([file.id]), ['department'], { department: ['财务部'] })
    expect(valid[0].categories.department).toBe('财务部')
    const invalidDictionary = parseAiClassifications({ version: 1, items: [{ fileId: file.id, categories: { department: '虚构部门' }, confidence: 'high' }] }, new Set([file.id]), ['department'], { department: ['财务部'] })
    expect(invalidDictionary[0]).toMatchObject({ categories: { department: null }, confidence: 'low' })
    expect(() => parseAiClassifications({ version: 1, items: [{ fileId: 'unknown', categories: {}, confidence: 'low' }] }, new Set([file.id]), ['department'], {})).toThrow('file_classification_unknown_id')
  })

  it('marks missing semantic classifications for confirmation and duplicate targets as conflicts', () => {
    const rules: FileOrganizeRule[] = [{ id: '1', type: 'department', aiRequired: true, enabled: true, order: 0 }]
    expect(buildMovePlan([file], rules, [])[0]).toMatchObject({ status: 'needs_confirmation', selected: false })
    const second = { ...file, id: 'file-00002', absolutePath: '/Users/test/其他/财务部_预算.xlsx', relativeParent: '其他' }
    const classifications = [file, second].map((item) => ({ fileId: item.id, categories: { department: '财务部' }, confidence: 'high' as const }))
    expect(buildMovePlan([file, second], rules, classifications)[1].status).toBe('conflict')
  })
})
