import type { PrivacyToken, ProtectedText } from './types'

interface PrivacyPattern { type: string; pattern: RegExp }

const PATTERNS: PrivacyPattern[] = [
  { type: 'TOKEN', pattern: /(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g },
  { type: 'PASSWORD', pattern: /(?:password|passwd|pwd|密码)\s*[:=：]\s*[^\s,，;；]{6,}/gi },
  { type: 'URLTOKEN', pattern: /https?:\/\/[^\s]+[?&](?:token|access_token|api_key|key)=[^\s&#]+/gi },
  { type: 'EMAIL', pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { type: 'IDCARD', pattern: /(?<!\d)(?:\d{17}[\dXx]|\d{15})(?!\d)/g },
  { type: 'PHONE', pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  { type: 'BANKCARD', pattern: /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g },
]

function nextToken(type: string, source: string, tokens: PrivacyToken[]): string {
  let index = tokens.filter((item) => item.type === type).length + 1
  let token = `__${type}_${String(index).padStart(4, '0')}__`
  while (source.includes(token) || tokens.some((item) => item.token === token)) {
    index += 1
    token = `__${type}_${String(index).padStart(4, '0')}__`
  }
  return token
}

export function protectSensitiveText(text: string, initialTokens: PrivacyToken[] = []): ProtectedText {
  const tokens = [...initialTokens]
  let protectedText = text
  for (const { type, pattern } of PATTERNS) {
    protectedText = protectedText.replace(pattern, (originalValue) => {
      if (/^__[A-Z]+_\d{4}__$/.test(originalValue)) return originalValue
      const token = nextToken(type, text, tokens)
      tokens.push({ token, originalValue, type })
      return token
    })
  }
  return { text: protectedText, tokens }
}

export function restorePrivacyTokens(text: string, tokens: readonly PrivacyToken[]): { text: string; unknownTokens: string[] } {
  const known = new Map(tokens.map((item) => [item.token, item.originalValue]))
  const unknownTokens = new Set<string>()
  const restored = text.replace(/__[A-Z]+_\d{4}__/g, (token) => {
    const original = known.get(token)
    if (original === undefined) {
      unknownTokens.add(token)
      return token
    }
    return original
  })
  return { text: restored, unknownTokens: [...unknownTokens] }
}

export function containsUnknownPrivacyToken(value: unknown, tokens: readonly PrivacyToken[]): boolean {
  if (typeof value !== 'string') return false
  return restorePrivacyTokens(value, tokens).unknownTokens.length > 0
}
