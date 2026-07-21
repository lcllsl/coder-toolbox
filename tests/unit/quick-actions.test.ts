import { describe, expect, it } from 'vitest'

import { createQuickValue, validateQuickUrl } from '@/features/quick-actions/core/quick-values'

describe('quick actions', () => {
  const now = new Date(2026, 6, 21, 9, 8, 7, 654)

  it('creates deterministic date, time and timestamp values', () => {
    expect(createQuickValue('date', now)).toBe('2026-07-21')
    expect(createQuickValue('time', now)).toBe('09:08:07')
    expect(createQuickValue('datetime', now)).toBe('2026-07-21 09:08:07')
    expect(createQuickValue('timestamp-seconds', now)).toBe(String(Math.floor(now.getTime() / 1000)))
    expect(createQuickValue('timestamp-milliseconds', now)).toBe(String(now.getTime()))
    expect(createQuickValue('uuid', now, 'fixed-uuid')).toBe('fixed-uuid')
  })

  it('accepts only complete HTTP and HTTPS URLs', () => {
    expect(validateQuickUrl('https://example.com').value).toBe('https://example.com/')
    expect(validateQuickUrl('http://localhost:3000/path').value).toBeTruthy()
    expect(validateQuickUrl('file:///tmp/private').error).toContain('http')
    expect(validateQuickUrl('example.com').error).toBeTruthy()
  })
})
