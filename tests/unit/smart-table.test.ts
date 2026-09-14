import * as XLSX from 'xlsx'
import { reactive } from 'vue'
import { describe, expect, it } from 'vitest'

import { createSmartTableCsv, createSmartTableTsv, createSmartTableXlsx, protectFormulaText, safeExportName } from '@/features/ai-office/smart-table/export'
import { protectSensitiveText, restorePrivacyTokens } from '@/features/ai-office/smart-table/privacy'
import { parseExtractionResult, parseSmartTableSchema } from '@/features/ai-office/smart-table/schema'
import { createSourceBatches, splitSourceBlocks } from '@/features/ai-office/smart-table/source'
import { createSmartTableResult, removeDuplicateRows, removeEmptyRows, rowNeedsReview, smartTableToDataset } from '@/features/ai-office/smart-table/table'
import type { SmartTable, SmartTableSchema } from '@/features/ai-office/smart-table/types'

const schema: SmartTableSchema = {
  version: 1,
  tableTitle: '事项整理',
  columns: [
    { id: 'owner', label: '负责人', type: 'text' },
    { id: 'deadline', label: '截止时间', type: 'date' },
    { id: 'phone', label: '电话', type: 'phone', sensitive: true },
    { id: 'amount', label: '金额', type: 'currency' },
  ],
}

function sampleTable(): SmartTable {
  return {
    version: 1,
    title: '事项整理',
    columns: schema.columns,
    sourceBlocks: [{ id: 'source-1', text: '张伟负责接口，电话13812345678', startOffset: 0, endOffset: 21 }],
    rows: [{
      id: 'row-1', sourceIds: ['source-1'], confidence: 'high', warnings: [],
      values: {
        owner: { value: '=HYPERLINK("bad")' }, deadline: { value: '2026-09-18' }, phone: { value: '0013800138000' }, amount: { value: 380 },
      },
    }],
  }
}

describe('smart table core', () => {
  it('splits source blocks with stable offsets and creates bounded batches', () => {
    const text = '1. 张伟负责接口\n\n2. 李娜负责预算\n3. 王强月底完成'
    const blocks = splitSourceBlocks(text)
    expect(blocks.map((block) => block.text)).toEqual(['1. 张伟负责接口', '2. 李娜负责预算', '3. 王强月底完成'])
    expect(blocks.every((block) => text.slice(block.startOffset, block.endOffset) === block.text)).toBe(true)
    expect(createSourceBatches(blocks, 2, 100).map((batch) => batch.sourceBlocks.length)).toEqual([2, 1])
  })

  it('tokenizes and restores sensitive values without restoring unknown tokens', () => {
    const protectedValue = protectSensitiveText('张伟 13812345678 zhang@example.com 440101199001011234 sk-abcdefghijklmnopqrstuv')
    expect(protectedValue.text).toMatch(/__PHONE_0001__/)
    expect(protectedValue.text).toMatch(/__EMAIL_0001__/)
    expect(protectedValue.text).toMatch(/__IDCARD_0001__/)
    expect(new Set(protectedValue.tokens.map((item) => item.token)).size).toBe(protectedValue.tokens.length)
    const restored = restorePrivacyTokens(`${protectedValue.text} __PHONE_9999__`, protectedValue.tokens)
    expect(restored.text).toContain('13812345678')
    expect(restored.text).toContain('__PHONE_9999__')
    expect(restored.unknownTokens).toEqual(['__PHONE_9999__'])
  })

  it('validates schemas and rejects duplicate or unsupported columns', () => {
    expect(parseSmartTableSchema(schema).columns).toHaveLength(4)
    expect(() => parseSmartTableSchema({ ...schema, columns: [schema.columns[0], schema.columns[0]] })).toThrow('smart_table_duplicate_column_id')
    expect(() => parseSmartTableSchema({ ...schema, columns: [{ id: 'x', label: 'X', type: 'formula' }] })).toThrow()
  })

  it('cleans extraction values, validates source ids and preserves phone/id text', () => {
    const result = parseExtractionResult({
      version: 1,
      rows: [{
        id: 'one', values: { owner: '张伟', deadline: '09-18', phone: 13812345678, amount: '380', invented: 'x' },
        sourceIds: ['source-1', 'source-999'], confidence: 'medium', warnings: ['截止时间缺少年份'],
      }],
    }, schema, new Set(['source-1']), [])
    expect(result[0].values.phone.value).toBe('13812345678')
    expect(result[0].values.amount.value).toBe(380)
    expect(result[0].sourceIds).toEqual(['source-1'])
    expect(result[0].values).not.toHaveProperty('invented')
    expect(result[0].confidence).toBe('low')
    expect(rowNeedsReview(result[0])).toBe(true)
  })

  it('removes only exact duplicates and fully empty rows', () => {
    const rows = parseExtractionResult({
      version: 1,
      rows: [
        { id: '1', values: { owner: '张伟', deadline: null, phone: null, amount: null }, sourceIds: ['source-1'], confidence: 'high', warnings: [] },
        { id: '2', values: { owner: '张伟', deadline: null, phone: null, amount: null }, sourceIds: ['source-1'], confidence: 'high', warnings: [] },
        { id: '3', values: { owner: null, deadline: null, phone: null, amount: null }, sourceIds: ['source-1'], confidence: 'high', warnings: [] },
      ],
    }, schema, new Set(['source-1']), [])
    const deduped = removeDuplicateRows(rows, schema.columns.map((column) => column.id))
    expect(deduped).toHaveLength(2)
    expect(removeEmptyRows(deduped, schema.columns.map((column) => column.id))).toHaveLength(1)
  })

  it('exports safe CSV, TSV and typed XLSX data', () => {
    const table = sampleTable()
    const csv = createSmartTableCsv(table)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain("'=HYPERLINK")
    expect(createSmartTableTsv(table)).toContain("'=HYPERLINK")
    expect(protectFormulaText('@cmd')).toBe("'@cmd")
    expect(safeExportName('项目/事项', 'xlsx')).toBe('项目_事项_整理结果.xlsx')

    const xlsx = createSmartTableXlsx(table)
    expect(xlsx).toBeInstanceOf(Uint8Array)
    expect(typeof xlsx.subarray).toBe('function')
    const workbook = XLSX.read(xlsx, { type: 'array', cellDates: true, cellStyles: true })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    expect(sheet.A2.v).toBe("'=HYPERLINK(\"bad\")")
    expect(sheet.A2.f).toBeUndefined()
    expect(sheet.C2.t).toBe('s')
    expect(sheet.C2.v).toBe('0013800138000')
    expect(sheet.D2.t).toBe('n')
    expect(sheet['!autofilter']?.ref).toBe('A1:D2')
  })

  it('adapts an edited table directly to the smart-chart dataset contract', () => {
    const dataset = smartTableToDataset(sampleTable())
    expect(dataset.columns.map((column) => column.kind)).toEqual(['text', 'date', 'text', 'currency'])
    expect(dataset.rows[0]).toMatchObject({ 负责人: '=HYPERLINK("bad")', 电话: '0013800138000', 金额: 380 })
  })

  it('builds the result from Vue reactive data without structured-clone failures', () => {
    const reactiveSchema = reactive(schema)
    const reactiveRows = reactive(sampleTable().rows)
    const reactiveSources = reactive(sampleTable().sourceBlocks)
    const result = createSmartTableResult(reactiveSchema, reactiveRows, reactiveSources)
    expect(result.title).toBe('事项整理')
    expect(result.rows).toHaveLength(1)
    expect(result.sourceBlocks[0].text).toContain('张伟负责接口')
  })
})
