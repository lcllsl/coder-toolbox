import { describe, expect, it } from 'vitest'

import { isPanelCategory, PANEL_CATEGORIES } from '@/types/navigation'

describe('panel category contract', () => {
  it('contains only the five first-level categories', () => {
    expect(PANEL_CATEGORIES).toEqual([
      'health',
      'clipboard',
      'dev-tools',
      'files',
      'quick-actions',
    ])
  })

  it('rejects settings as a petal category', () => {
    expect(isPanelCategory('settings')).toBe(false)
    expect(isPanelCategory('dev-tools')).toBe(true)
  })
})
