import type { ReminderId } from '../types'

export const REMINDER_AUTO_COMPLETE_SECONDS = 30
export const REMINDER_AUTO_COMPLETE_MS = REMINDER_AUTO_COMPLETE_SECONDS * 1_000

export function createReminderAutoCompleteAt(now = new Date()): string {
  return new Date(now.getTime() + REMINDER_AUTO_COMPLETE_MS).toISOString()
}

export function hasReminderWindowElapsed(triggerAt: string | undefined, now = new Date()): boolean {
  if (!triggerAt) return false
  const triggerMs = new Date(triggerAt).getTime()
  return Number.isFinite(triggerMs) && triggerMs + REMINDER_AUTO_COMPLETE_MS <= now.getTime()
}

export function getExpiredReminderIds(
  pendingIds: readonly ReminderId[],
  autoCompleteAt: Readonly<Partial<Record<ReminderId, string>>>,
  now = new Date(),
): ReminderId[] {
  const nowMs = now.getTime()
  return pendingIds.filter((id) => {
    const deadline = autoCompleteAt[id]
    return deadline !== undefined && new Date(deadline).getTime() <= nowMs
  })
}
