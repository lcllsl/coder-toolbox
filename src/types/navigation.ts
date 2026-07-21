export const PANEL_CATEGORIES = [
  'health',
  'clipboard',
  'dev-tools',
  'files',
  'quick-actions',
] as const

export type PanelCategory = (typeof PANEL_CATEGORIES)[number]

export interface PanelNavigationPayload {
  category: PanelCategory | 'settings'
}

export const CATEGORY_LABELS: Record<PanelCategory, string> = {
  health: '健康提醒',
  clipboard: '剪贴板',
  'dev-tools': '开发转换',
  files: '文件与路径',
  'quick-actions': '快捷入口',
}

export interface CategoryPresentation {
  accent: string
  summary: string
  features: readonly string[]
}

export const CATEGORY_PRESENTATION: Record<PanelCategory, CategoryPresentation> = {
  health: {
    accent: 'var(--color-health)',
    summary: '用轻量提醒照顾久坐、饮水与姿势习惯。',
    features: ['今日节奏', '提醒计划', '完成记录'],
  },
  clipboard: {
    accent: 'var(--color-clipboard)',
    summary: '快速检索和整理近期复制的文本、图片与文件。',
    features: ['最近复制', '收藏内容', '快速搜索'],
  },
  'dev-tools': {
    accent: 'var(--color-dev-tools)',
    summary: '集中处理常用编码、格式化与时间转换。',
    features: ['JSON', 'URL', 'Base64'],
  },
  files: {
    accent: 'var(--color-files)',
    summary: '转换路径格式并快速定位常用文件位置。',
    features: ['路径转换', '文件定位', '批量处理'],
  },
  'quick-actions': {
    accent: 'var(--color-quick-actions)',
    summary: '把常用网站、应用和动作放在触手可及的位置。',
    features: ['常用入口', '收藏动作', '最近使用'],
  },
}

export function isPanelCategory(value: string): value is PanelCategory {
  return PANEL_CATEGORIES.some((category) => category === value)
}
