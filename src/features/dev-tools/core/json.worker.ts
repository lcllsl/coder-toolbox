/// <reference lib="webworker" />

import { formatJson, minifyJson, validateJson, type JsonIndent, type JsonResult } from './json'

export interface JsonWorkerRequest {
  input: string
  mode: 'format' | 'minify' | 'validate'
  indent: JsonIndent
}

export interface JsonWorkerResponse {
  result?: JsonResult
  error?: string
}

self.onmessage = (event: MessageEvent<JsonWorkerRequest>) => {
  const { input, mode, indent } = event.data
  try {
    const result = mode === 'format' ? formatJson(input, indent) : mode === 'minify' ? minifyJson(input) : validateJson(input)
    self.postMessage({ result } satisfies JsonWorkerResponse)
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'JSON 处理失败' } satisfies JsonWorkerResponse)
  }
}
