import { normalizeBase64 } from './base64'

export interface JwtTimeClaim {
  value: number
  local: string
  utc: string
}

export interface JwtResult {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  claims: Partial<Record<'exp' | 'iat' | 'nbf', JwtTimeClaim>>
  expired: boolean | null
}

function decodeSegment(segment: string): Record<string, unknown> {
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(normalizeBase64(base64))
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error()
    return value as Record<string, unknown>
  } catch {
    throw new Error('JWT Header 或 Payload 无法解析')
  }
}

export function parseJwt(token: string, now = Date.now()): JwtResult {
  const parts = token.trim().split('.')
  if (parts.length !== 3 || !parts[0] || !parts[1]) throw new Error('JWT 必须包含三个点分隔部分')
  const header = decodeSegment(parts[0])
  const payload = decodeSegment(parts[1])
  const claims: JwtResult['claims'] = {}
  for (const name of ['exp', 'iat', 'nbf'] as const) {
    const value = payload[name]
    if (typeof value === 'number' && Number.isFinite(value)) {
      const date = new Date(value * 1_000)
      claims[name] = { value, local: date.toLocaleString(), utc: date.toISOString() }
    }
  }
  return {
    header,
    payload,
    claims,
    expired: claims.exp ? claims.exp.value * 1_000 <= now : null,
  }
}
