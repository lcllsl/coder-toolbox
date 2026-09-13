import { describe, expect, it } from 'vitest'

import { validateGlobalShortcut } from '@/features/settings/core/shortcuts'
import { normalizeVaultAutoLockMinutes, shouldConfigureVaultAutoLock } from '@/features/settings/repositories/app-settings-repository'

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

  it('accepts only the four supported vault auto-lock durations', () => {
    for (const minutes of [1, 5, 15, 30]) {
      expect(normalizeVaultAutoLockMinutes(minutes)).toBe(minutes)
    }
    for (const invalid of [0, 2, 60, '5', null, undefined]) {
      expect(normalizeVaultAutoLockMinutes(invalid)).toBe(5)
    }
  })

  it('does not call panel-only vault configuration while the native orb initializes', () => {
    expect(shouldConfigureVaultAutoLock(true, 'orb-window')).toBe(false)
    expect(shouldConfigureVaultAutoLock(true, 'panel-window')).toBe(true)
    expect(shouldConfigureVaultAutoLock(false, 'orb-window')).toBe(true)
  })
})
