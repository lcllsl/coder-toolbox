import { describe, expect, it } from 'vitest'

import { isPanelCategory, normalizePanelCategory, PANEL_CATEGORIES } from '@/types/navigation'

describe('panel category contract', () => {
  it('contains only the five first-level categories', () => {
    expect(PANEL_CATEGORIES).toEqual([
      'ai-office',
      'clipboard',
      'files',
      'quick-actions',
      'health',
    ])
  })

  it('rejects settings as a petal category', () => {
    expect(isPanelCategory('settings')).toBe(false)
    expect(isPanelCategory('dev-tools')).toBe(false)
    expect(normalizePanelCategory('dev-tools')).toBe('quick-actions')
    expect(normalizePanelCategory('ai-office')).toBe('ai-office')
  })
})
