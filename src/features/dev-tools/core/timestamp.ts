export type TimestampUnit = 'seconds' | 'milliseconds'

export interface TimestampResult {
  milliseconds: number
  unit: TimestampUnit
  local: string
  utc: string
}

export function parseTimestamp(input: string): TimestampResult {
  const normalized = input.trim()
  if (!/^\d{10}$|^\d{13}$/.test(normalized)) {
    throw new Error('请输入 10 位秒级或 13 位毫秒级时间戳')
  }
  const unit: TimestampUnit = normalized.length === 10 ? 'seconds' : 'milliseconds'
  const milliseconds = Number(normalized) * (unit === 'seconds' ? 1_000 : 1)
  const date = new Date(milliseconds)
  if (Number.isNaN(date.getTime())) throw new Error('时间戳超出可识别范围')
  return { milliseconds, unit, local: date.toLocaleString(), utc: date.toISOString() }
}

export function dateTimeToTimestamp(input: string, unit: TimestampUnit): string {
  if (!input) throw new Error('请选择日期和时间')
  const milliseconds = new Date(input).getTime()
  if (Number.isNaN(milliseconds)) throw new Error('日期时间无效')
  return String(unit === 'seconds' ? Math.floor(milliseconds / 1_000) : milliseconds)
}

export function currentTimestamp(unit: TimestampUnit, now = Date.now()): string {
  return String(unit === 'seconds' ? Math.floor(now / 1_000) : now)
}
