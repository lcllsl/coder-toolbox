import { describe, expect, it } from 'vitest'

import { validateGlobalShortcut } from '@/features/settings/core/shortcuts'

describe('settings shortcuts', () => {
  it('normalizes valid global shortcuts', () => {
    expect(validateGlobalShortcut('ctrl + alt + space')).toEqual({ value: 'Ctrl+Alt+Space' })
    expect(validateGlobalShortcut('CmdOrCtrl+Shift+K')).toEqual({ value: 'CommandOrControl+Shift+K' })
  })

  it('rejects weak, duplicate and common system shortcuts', () => {
    expect(validateGlobalShortcut('Ctrl+K').error).toContain('两个修饰键')
    expect(validateGlobalShortcut('Ctrl+Ctrl+K').error).toContain('重复')
    expect(validateGlobalShortcut('Command+Space').error).toBeTruthy()
  })
})
