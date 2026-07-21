import { formatJson, minifyJson, validateJson, type JsonIndent, type JsonResult } from './json'
import type { JsonWorkerRequest, JsonWorkerResponse } from './json.worker'

export const LARGE_JSON_THRESHOLD = 2 * 1024 * 1024

export async function processJson(
  input: string,
  mode: JsonWorkerRequest['mode'],
  indent: JsonIndent,
): Promise<JsonResult> {
  if (new Blob([input]).size <= LARGE_JSON_THRESHOLD || typeof Worker === 'undefined') {
    return mode === 'format' ? formatJson(input, indent) : mode === 'minify' ? minifyJson(input) : validateJson(input)
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./json.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<JsonWorkerResponse>) => {
      worker.terminate()
      if (event.data.result) resolve(event.data.result)
      else reject(new Error(event.data.error ?? 'JSON 处理失败'))
    }
    worker.onerror = () => {
      worker.terminate()
      reject(new Error('大文本处理线程启动失败'))
    }
    worker.postMessage({ input, mode, indent } satisfies JsonWorkerRequest)
  })
}
