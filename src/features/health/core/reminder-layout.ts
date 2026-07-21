import type { HitRegion, OrbWindowGeometry } from '@/types/orb'

export const REMINDER_CARD_WIDTH = 238
export const REMINDER_CARD_HEIGHT = 126

export function computeReminderCardRegion(geometry: OrbWindowGeometry): HitRegion {
  let x: number
  let y: number
  if (geometry.horizontal === 'left') {
    x = geometry.orbX - REMINDER_CARD_WIDTH - 28
    y = geometry.orbY - REMINDER_CARD_HEIGHT / 2
  } else if (geometry.horizontal === 'right') {
    x = geometry.orbX + 28
    y = geometry.orbY - REMINDER_CARD_HEIGHT / 2
  } else {
    x = geometry.orbX - REMINDER_CARD_WIDTH / 2
    y = geometry.vertical === 'down'
      ? geometry.orbY + 42
      : geometry.orbY - REMINDER_CARD_HEIGHT - 42
  }
  return {
    id: 'health-reminder-card',
    x: Math.max(8, Math.min(geometry.width - REMINDER_CARD_WIDTH - 8, x)),
    y: Math.max(8, Math.min(geometry.height - REMINDER_CARD_HEIGHT - 8, y)),
    width: REMINDER_CARD_WIDTH,
    height: REMINDER_CARD_HEIGHT,
  }
}
