export type JsonIndent = 2 | 4

export interface JsonResult {
  value: string
  message: string
}

export class JsonInputError extends Error {
  line?: number
  column?: number

  constructor(message: string, line?: number, column?: number) {
    super(message)
    this.name = 'JsonInputError'
    this.line = line
    this.column = column
  }
}

function locateJsonError(input: string, error: unknown): JsonInputError {
  const raw = error instanceof Error ? error.message : 'JSON 内容无效'
  const positionMatch = raw.match(/position\s+(\d+)/i)
  const lineColumnMatch = raw.match(/line\s+(\d+)\s+column\s+(\d+)/i)
  let line: number | undefined
  let column: number | undefined

  if (positionMatch) {
    const position = Number(positionMatch[1])
    const before = input.slice(0, position)
    line = before.split('\n').length
    column = position - before.lastIndexOf('\n')
  } else if (lineColumnMatch) {
    line = Number(lineColumnMatch[1])
    column = Number(lineColumnMatch[2])
  }

  const location = line && column ? `第 ${line} 行第 ${column} 列附近` : '输入内容中'
  return new JsonInputError(`${location}存在 JSON 语法错误`, line, column)
}

export function parseJson(input: string): unknown {
  if (!input.trim()) throw new JsonInputError('请输入 JSON 内容')
  try {
    return JSON.parse(input)
  } catch (error) {
    throw locateJsonError(input, error)
  }
}

export function formatJson(input: string, indent: JsonIndent = 2): JsonResult {
  return { value: JSON.stringify(parseJson(input), null, indent), message: `JSON 有效，已使用 ${indent} 空格缩进` }
}

export function minifyJson(input: string): JsonResult {
  return { value: JSON.stringify(parseJson(input)), message: 'JSON 有效，已压缩' }
}

export function validateJson(input: string): JsonResult {
  parseJson(input)
  return { value: input, message: 'JSON 语法有效' }
}
