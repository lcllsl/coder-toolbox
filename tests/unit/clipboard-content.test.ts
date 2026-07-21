import { describe, expect, it } from 'vitest'

import type { ClipboardItem } from '@/features/clipboard/types'
import { classifyClipboardText, detectSensitiveText, hashClipboardImage, hashClipboardText, shouldMergeWithLatest } from '@/features/clipboard/core/content'

describe('clipboard content rules', () => {
  it('classifies common text without changing the original value', () => {
    expect(classifyClipboardText('https://example.com/a?q=1')).toBe('url')
    expect(classifyClipboardText('{"ready":true}')).toBe('json')
    expect(classifyClipboardText('#34c7aa')).toBe('color')
    expect(classifyClipboardText('hello@example.com')).toBe('email')
    expect(classifyClipboardText('const answer = 42;')).toBe('code')
    expect(classifyClipboardText('  ordinary text  ')).toBe('plain_text')
  })

  it('detects high-confidence sensitive content', () => {
    expect(detectSensitiveText('-----BEGIN PRIVATE KEY-----\nabc')).toBe(true)
    expect(detectSensitiveText('验证码：846291，请勿告知他人')).toBe(true)
    expect(detectSensitiveText('password = correct-horse-battery')).toBe(true)
    expect(detectSensitiveText('4111 1111 1111 1111')).toBe(true)
    expect(detectSensitiveText('今天下午三点开会')).toBe(false)
  })

  it('hashes exact source text and only merges the latest exact match', () => {
    expect(hashClipboardText('value')).not.toBe(hashClipboardText('value '))
    const latest = { contentHash: hashClipboardText('value'), textContent: 'value' } as ClipboardItem
    expect(shouldMergeWithLatest(latest, hashClipboardText('value'), 'value')).toBe(true)
    expect(shouldMergeWithLatest(latest, hashClipboardText('value '), 'value ')).toBe(false)
  })

  it('includes image dimensions and exact RGBA bytes in image fingerprints', () => {
    const pixels = new Uint8Array([255, 0, 0, 255])
    expect(hashClipboardImage(pixels, 1, 1)).toBe(hashClipboardImage(pixels, 1, 1))
    expect(hashClipboardImage(pixels, 1, 1)).not.toBe(hashClipboardImage(pixels, 2, 1))
    expect(hashClipboardImage(pixels, 1, 1)).not.toBe(hashClipboardImage(new Uint8Array([254, 0, 0, 255]), 1, 1))
  })
})
