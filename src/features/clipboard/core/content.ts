import type { ClipboardContentType, ClipboardItem } from '../types'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_PATTERN = /^https?:\/\/[^\s]+$/i
const COLOR_PATTERN = /^(?:#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|rgba?\([^\n]+\)|hsla?\([^\n]+\))$/i
const CODE_PATTERN = /(?:^|\n)\s*(?:const|let|var|function|class|interface|import|export|def|fn|SELECT|INSERT|UPDATE)\b|[{};]\s*$/m
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
const TOKEN_PATTERN = /(?:^|[\s"'])(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})(?:$|[\s"'])/
const PASSWORD_PATTERN = /(?:password|passwd|pwd|密码)\s*[:=]\s*\S{6,}/i
const OTP_PATTERN = /(?:验证码|校验码|动态码|verification code|one[- ]time code|otp)\D{0,12}(\d{4,8})/i

function isJson(text: string): boolean {
  if (!/^[\[{]/.test(text) || !/[\]}]$/.test(text)) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function passesLuhn(value: string): boolean {
  let sum = 0
  let doubleDigit = false
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const digit = Number(value[index])
    let next = digit
    if (doubleDigit) {
      next *= 2
      if (next > 9) next -= 9
    }
    sum += next
    doubleDigit = !doubleDigit
  }
  return sum % 10 === 0
}

export function classifyClipboardText(text: string): ClipboardContentType {
  if (URL_PATTERN.test(text)) return 'url'
  if (EMAIL_PATTERN.test(text)) return 'email'
  if (COLOR_PATTERN.test(text)) return 'color'
  if (isJson(text)) return 'json'
  if (CODE_PATTERN.test(text)) return 'code'
  return 'plain_text'
}

export function detectSensitiveText(text: string): boolean {
  if (PRIVATE_KEY_PATTERN.test(text) || TOKEN_PATTERN.test(text) || PASSWORD_PATTERN.test(text) || OTP_PATTERN.test(text)) return true
  const digits = text.replace(/[\s-]/g, '')
  return /^\d{13,19}$/.test(digits) && passesLuhn(digits)
}

export function hashClipboardText(text: string): string {
  const bytes = new TextEncoder().encode(text)
  return `text:${hashBytes(bytes)}:${bytes.length}`
}

function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function hashClipboardImage(rgba: Uint8Array, width: number, height: number): string {
  return `image:${width}x${height}:${hashBytes(rgba)}:${rgba.length}`
}

export function createPreviewText(text: string, limit = 320): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

export function shouldMergeWithLatest(latest: ClipboardItem | undefined, contentHash: string, text: string): boolean {
  return Boolean(latest && latest.contentHash === contentHash && latest.textContent === text)
}
