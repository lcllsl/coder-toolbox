import { describe, expect, it } from 'vitest'

import { decodeBase64Utf8, encodeBase64Utf8, normalizeBase64 } from '@/features/dev-tools/core/base64'
import { formatJson, JsonInputError, minifyJson } from '@/features/dev-tools/core/json'
import { parseJwt } from '@/features/dev-tools/core/jwt'
import { dateTimeToTimestamp, parseTimestamp } from '@/features/dev-tools/core/timestamp'
import { detectUrlEncoding, transformUrl } from '@/features/dev-tools/core/url'
import { generateUuids } from '@/features/dev-tools/core/uuid'

describe('JSON tools', () => {
  it('formats and minifies without changing string values', () => {
    const input = '{"message":"a  b","items":[1,2]}'
    expect(formatJson(input, 2).value).toContain('\n  "message": "a  b"')
    expect(minifyJson(formatJson(input, 4).value).value).toBe(input)
  })

  it('reports a readable location for invalid JSON', () => {
    try {
      formatJson('{\n  "a": 1,\n  "b" 2\n}')
      throw new Error('expected formatJson to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(JsonInputError)
      expect((error as Error).message).toMatch(/第 \d+ 行第 \d+ 列|语法错误/)
    }
  })
})

describe('URL tools', () => {
  it('encodes and decodes URI components', () => {
    const encoded = transformUrl('你好 a/b', 'encode-component')
    expect(encoded).toBe('%E4%BD%A0%E5%A5%BD%20a%2Fb')
    expect(transformUrl(encoded, 'decode')).toBe('你好 a/b')
    expect(detectUrlEncoding(encoded)).toBe('encoded')
  })

  it('round-trips repeated query parameters through JSON', () => {
    const json = transformUrl('tag=one&tag=two&page=1', 'query-to-json')
    expect(JSON.parse(json)).toEqual({ tag: ['one', 'two'], page: '1' })
    expect(transformUrl(json, 'json-to-query')).toBe('tag=one&tag=two&page=1')
  })
})

describe('Base64 tools', () => {
  it('round-trips UTF-8 text', () => {
    const encoded = encodeBase64Utf8('花瓣🌸 toolbox')
    expect(decodeBase64Utf8(encoded)).toBe('花瓣🌸 toolbox')
  })

  it('rejects invalid Base64 input', () => {
    expect(() => normalizeBase64('%%%invalid%%%')).toThrow('有效的 Base64')
  })
})

describe('timestamp tools', () => {
  it('detects seconds and milliseconds automatically', () => {
    expect(parseTimestamp('1700000000').unit).toBe('seconds')
    expect(parseTimestamp('1700000000000').unit).toBe('milliseconds')
    expect(parseTimestamp('1700000000').milliseconds).toBe(1_700_000_000_000)
  })

  it('converts date-time input to both units', () => {
    const input = '2024-01-01T00:00:00Z'
    expect(dateTimeToTimestamp(input, 'milliseconds')).toBe('1704067200000')
    expect(dateTimeToTimestamp(input, 'seconds')).toBe('1704067200')
  })
})

describe('JWT tools', () => {
  const segment = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  it('parses claims and identifies expired tokens without validating signatures', () => {
    const token = `${segment({ alg: 'none' })}.${segment({ sub: '42', exp: 100, iat: 10 })}.signature`
    const result = parseJwt(token, 101_000)
    expect(result.payload.sub).toBe('42')
    expect(result.claims.iat?.value).toBe(10)
    expect(result.expired).toBe(true)
  })

  it('rejects malformed tokens', () => {
    expect(() => parseJwt('not-a-token')).toThrow('三个点分隔部分')
  })
})

describe('UUID tools', () => {
  it('generates the requested number of RFC 4122 version 4 values', () => {
    const values = generateUuids({ count: 5 })
    expect(values).toHaveLength(5)
    expect(new Set(values).size).toBe(5)
    expect(values.every((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))).toBe(true)
  })

  it('supports compact uppercase output', () => {
    expect(generateUuids({ count: 1, compact: true, uppercase: true })[0]).toMatch(/^[0-9A-F]{32}$/)
  })
})
