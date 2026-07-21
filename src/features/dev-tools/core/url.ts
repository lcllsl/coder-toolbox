export type UrlOperation = 'encode-component' | 'encode-uri' | 'decode' | 'query-to-json' | 'json-to-query'

export function detectUrlEncoding(input: string): 'encoded' | 'plain' {
  try {
    return decodeURIComponent(input) !== input ? 'encoded' : 'plain'
  } catch {
    return 'encoded'
  }
}

export function transformUrl(input: string, operation: UrlOperation): string {
  if (!input.trim()) throw new Error('请输入需要处理的内容')

  switch (operation) {
    case 'encode-component':
      return encodeURIComponent(input)
    case 'encode-uri':
      return encodeURI(input)
    case 'decode':
      try {
        return decodeURIComponent(input)
      } catch {
        throw new Error('输入包含无效的 URL 编码序列')
      }
    case 'query-to-json': {
      const query = input.includes('?') ? input.slice(input.indexOf('?') + 1) : input.replace(/^\?/, '')
      const params = new URLSearchParams(query.split('#')[0])
      const result: Record<string, string | string[]> = {}
      for (const [key, value] of params) {
        const previous = result[key]
        if (previous === undefined) result[key] = value
        else result[key] = Array.isArray(previous) ? [...previous, value] : [previous, value]
      }
      return JSON.stringify(result, null, 2)
    }
    case 'json-to-query': {
      let value: unknown
      try {
        value = JSON.parse(input)
      } catch {
        throw new Error('请输入有效的 JSON 对象')
      }
      if (!value || Array.isArray(value) || typeof value !== 'object') {
        throw new Error('查询参数必须由 JSON 对象生成')
      }
      const params = new URLSearchParams()
      for (const [key, item] of Object.entries(value)) {
        const values = Array.isArray(item) ? item : [item]
        for (const entry of values) {
          if (entry === null || entry === undefined) continue
          params.append(key, typeof entry === 'object' ? JSON.stringify(entry) : String(entry))
        }
      }
      return params.toString()
    }
  }
}
