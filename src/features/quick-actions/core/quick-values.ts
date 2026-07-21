import type { QuickCopyAction } from '../types'

function parts(date: Date) {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}:${second}` }
}

export function createQuickValue(action: QuickCopyAction, now = new Date(), uuid = crypto.randomUUID()) {
  const value = parts(now)
  switch (action) {
    case 'date': return value.date
    case 'time': return value.time
    case 'datetime': return `${value.date} ${value.time}`
    case 'timestamp-seconds': return String(Math.floor(now.getTime() / 1000))
    case 'timestamp-milliseconds': return String(now.getTime())
    case 'uuid': return uuid
  }
}

export function validateQuickUrl(input: string) {
  try {
    const url = new URL(input.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? { value: url.toString() }
      : { error: '只允许 http 或 https 地址' }
  } catch {
    return { error: '请输入完整有效的网址' }
  }
}
