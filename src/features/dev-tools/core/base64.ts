function bytesToBinary(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return binary
}

export function encodeBase64Utf8(input: string): string {
  if (!input) throw new Error('请输入需要编码的文本')
  return btoa(bytesToBinary(new TextEncoder().encode(input)))
}

export function normalizeBase64(input: string): string {
  const raw = input.trim().replace(/^data:[^;,]+;base64,/, '').replace(/\s/g, '')
  if (!raw || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 === 1) {
    throw new Error('输入不是有效的 Base64 内容')
  }
  return raw.padEnd(Math.ceil(raw.length / 4) * 4, '=')
}

export function decodeBase64Utf8(input: string): string {
  try {
    const binary = atob(normalizeBase64(input))
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    if (error instanceof Error && error.message.includes('Base64')) throw error
    throw new Error('Base64 不是有效的 UTF-8 文本')
  }
}

export function stripDataUrl(input: string): string {
  return normalizeBase64(input)
}

export function toDataUrl(input: string, mimeType = 'text/plain;charset=utf-8'): string {
  return `data:${mimeType};base64,${normalizeBase64(input)}`
}
