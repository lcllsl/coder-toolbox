export const FEATURE_CATEGORY_CONFIGS = [
  { id: 'ai-office', label: 'AI 办公', icon: 'sparkles', accent: 'var(--color-ai-office)', summary: '让数据和日常办公处理更简单。', panelSize: { width: 1040, height: 760 }, route: '/category/ai-office', enabled: true, status: 'ready' },
  { id: 'clipboard', label: '剪贴板', icon: 'clipboard', accent: 'var(--color-clipboard)', summary: '找回刚刚复制过的文字、链接或图片。', panelSize: { width: 720, height: 700 }, route: '/category/clipboard', enabled: true, status: 'ready' },
  { id: 'files', label: '文件中心', icon: 'folder', accent: 'var(--color-files)', summary: '常用位置、临时中转和路径工具集中管理。', panelSize: { width: 680, height: 640 }, route: '/category/files', enabled: true, status: 'ready' },
  { id: 'quick-actions', label: '效率工具', icon: 'briefcase', accent: 'var(--color-quick-actions)', summary: '常用操作，一点即达。', panelSize: { width: 740, height: 650 }, route: '/category/quick-actions', enabled: true, status: 'ready' },
  { id: 'health', label: '健康助手', icon: 'health', accent: 'var(--color-health)', summary: '用轻量提醒照顾久坐、饮水与姿势习惯。', panelSize: { width: 560, height: 600 }, route: '/category/health', enabled: true, status: 'ready' },
] as const

export type PanelCategory = (typeof FEATURE_CATEGORY_CONFIGS)[number]['id']
export type LegacyPanelCategory = 'dev-tools'
export type NavigablePanelCategory = PanelCategory | LegacyPanelCategory

export const PANEL_CATEGORIES = FEATURE_CATEGORY_CONFIGS.map((category) => category.id) as PanelCategory[]

export interface PanelNavigationPayload {
  category: NavigablePanelCategory | 'settings'
}

export const CATEGORY_LABELS = Object.fromEntries(
  FEATURE_CATEGORY_CONFIGS.map((category) => [category.id, category.label]),
) as Record<PanelCategory, string>

export const CATEGORY_PRESENTATION = Object.fromEntries(
  FEATURE_CATEGORY_CONFIGS.map((category) => [category.id, category]),
) as Record<PanelCategory, (typeof FEATURE_CATEGORY_CONFIGS)[number]>

export function isPanelCategory(value: string): value is PanelCategory {
  return PANEL_CATEGORIES.some((category) => category === value)
}

export function normalizePanelCategory(value: string): PanelCategory | undefined {
  if (value === 'dev-tools') return 'quick-actions'
  return isPanelCategory(value) ? value : undefined
}
