import Database from '@tauri-apps/plugin-sql'

import { isTauriRuntime } from '@/services/tauri/runtime'
import type { ReminderAction, ReminderId, ReminderLog } from '../types'

const BROWSER_KEY = 'petal-toolbox.reminder-logs'
let database: Promise<Database> | undefined

function getDatabase() {
  database ??= Database.load('sqlite:petal-toolbox.db')
  return database
}

function browserLogs(): ReminderLog[] {
  try { return JSON.parse(localStorage.getItem(BROWSER_KEY) ?? '[]') as ReminderLog[] }
  catch { return [] }
}

export async function addReminderLog(reminderId: ReminderId, action: ReminderAction, occurredAt = new Date()): Promise<ReminderLog> {
  const log: ReminderLog = { id: crypto.randomUUID(), reminderId, action, occurredAt: occurredAt.toISOString() }
  if (isTauriRuntime()) {
    await (await getDatabase()).execute(
      'INSERT INTO reminder_logs (id, reminder_id, action, occurred_at) VALUES ($1, $2, $3, $4)',
      [log.id, log.reminderId, log.action, log.occurredAt],
    )
  } else {
    localStorage.setItem(BROWSER_KEY, JSON.stringify([...browserLogs(), log]))
  }
  return log
}

interface CountRow { reminderId: ReminderId; count: number }

export async function getCompletedCounts(from: Date, to: Date): Promise<Partial<Record<ReminderId, number>>> {
  if (isTauriRuntime()) {
    const rows = await (await getDatabase()).select<CountRow[]>(
      `SELECT reminder_id AS reminderId, COUNT(*) AS count FROM reminder_logs
       WHERE action = 'completed' AND occurred_at >= $1 AND occurred_at < $2 GROUP BY reminder_id`,
      [from.toISOString(), to.toISOString()],
    )
    return Object.fromEntries(rows.map((row) => [row.reminderId, Number(row.count)]))
  }
  const counts: Partial<Record<ReminderId, number>> = {}
  for (const log of browserLogs()) {
    const time = new Date(log.occurredAt)
    if (log.action === 'completed' && time >= from && time < to) counts[log.reminderId] = (counts[log.reminderId] ?? 0) + 1
  }
  return counts
}

export async function getTodayCompletedCounts(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return getCompletedCounts(start, end)
}

export async function clearReminderLogs(): Promise<void> {
  if (!isTauriRuntime()) {
    localStorage.setItem(BROWSER_KEY, '[]')
    return
  }
  await (await getDatabase()).execute('DELETE FROM reminder_logs')
}
