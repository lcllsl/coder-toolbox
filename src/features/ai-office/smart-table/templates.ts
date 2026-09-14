import type { SmartTableColumn, SmartTableSchema, SmartTableTemplate, SmartTableTemplateId } from './types'

export const SMART_TABLE_TEMPLATES: SmartTableTemplate[] = [
  { id: 'auto', label: '自动识别', columns: [] },
  { id: 'people', label: '人员名单', columns: [
    { label: '姓名', type: 'text' }, { label: '部门/单位', type: 'category' }, { label: '职务', type: 'text' },
    { label: '联系方式', type: 'phone', sensitive: true }, { label: '城市', type: 'category' }, { label: '备注', type: 'text' },
  ] },
  { id: 'tasks', label: '工作事项', columns: [
    { label: '负责人', type: 'text' }, { label: '事项', type: 'text' }, { label: '截止时间', type: 'date' },
    { label: '状态', type: 'category' }, { label: '备注', type: 'text' },
  ] },
  { id: 'expenses', label: '费用记录', columns: [
    { label: '日期', type: 'date' }, { label: '事项', type: 'text' }, { label: '费用类型', type: 'category' },
    { label: '金额', type: 'currency' }, { label: '经办人', type: 'text' }, { label: '备注', type: 'text' },
  ] },
  { id: 'devices', label: '设备记录', columns: [
    { label: '设备名称', type: 'text' }, { label: '型号', type: 'id' }, { label: '位置', type: 'text' },
    { label: '状态', type: 'category' }, { label: '负责人', type: 'text' }, { label: '备注', type: 'text' },
  ] },
  { id: 'registration', label: '报名信息', columns: [
    { label: '姓名', type: 'text' }, { label: '单位', type: 'text' }, { label: '联系方式', type: 'phone', sensitive: true },
    { label: '报名项目', type: 'category' }, { label: '备注', type: 'text' },
  ] },
]

function safeId(label: string, index: number): string {
  const ascii = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return ascii || `column_${index + 1}`
}

export function createTemplateSchema(templateId: SmartTableTemplateId, targetDescription = ''): SmartTableSchema {
  const template = SMART_TABLE_TEMPLATES.find((item) => item.id === templateId) ?? SMART_TABLE_TEMPLATES[0]
  const requested = targetDescription.split(/[，,、;；\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 12)
  const source = requested.length
    ? requested.map((label) => ({ label, type: 'text' as const }))
    : template.columns.length ? template.columns : [{ label: '内容', type: 'text' as const }, { label: '备注', type: 'text' as const }]
  const columns: SmartTableColumn[] = source.map((column, index) => ({ ...column, id: safeId(column.label, index) }))
  return { version: 1, tableTitle: template.id === 'auto' ? '信息整理结果' : `${template.label}整理`, columns }
}
