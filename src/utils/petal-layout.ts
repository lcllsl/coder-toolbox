import type { CSSProperties } from 'vue'

import type { HitRegion, OrbWindowGeometry, Point } from '@/types/orb'
import type { PanelCategory } from '@/types/navigation'

export interface PetalPlacement extends Point {
  category: PanelCategory
  angle: number
  delayMs: number
  style: CSSProperties
}

export interface PetalLayoutOptions {
  geometry: OrbWindowGeometry
  categories: readonly PanelCategory[]
  radius?: number
  spreadDegrees?: number
}

const PETAL_WIDTH = 96
const PETAL_HEIGHT = 76
const ORB_HIT_SIZE = 72

function centerAngle(geometry: OrbWindowGeometry): number {
  if (geometry.horizontal === 'center') {
    if (geometry.vertical === 'down') return 90
    if (geometry.vertical === 'up') return 270
    return 0
  }

  if (geometry.horizontal === 'left') {
    if (geometry.vertical === 'up') return 225
    if (geometry.vertical === 'down') return 135
    return 180
  }

  if (geometry.vertical === 'up') return 315
  if (geometry.vertical === 'down') return 45
  return 0
}

export function computePetalLayout({
  geometry,
  categories,
  radius,
  spreadDegrees,
}: PetalLayoutOptions): PetalPlacement[] {
  if (categories.length === 0) return []

  const isCornerFan = geometry.horizontal !== 'center' && geometry.vertical !== 'center'
  if (isCornerFan) {
    const horizontalSign = geometry.horizontal === 'left' ? -1 : 1
    const verticalSign = geometry.vertical === 'up' ? -1 : 1
    const cornerOffsets = [
      { x: 118, y: 0 },
      { x: 160, y: 58 },
      { x: 120, y: 120 },
      { x: 58, y: 160 },
      { x: 0, y: 118 },
    ] as const

    return categories.map((category, index) => {
      const offset = cornerOffsets[index] ?? cornerOffsets[cornerOffsets.length - 1]!
      const x = geometry.orbX + offset.x * horizontalSign
      const y = geometry.orbY + offset.y * verticalSign
      const angle = (Math.atan2(y - geometry.orbY, x - geometry.orbX) * 180) / Math.PI

      return createPlacement(category, index, x, y, angle, geometry)
    })
  }

  const baseRadius = radius ?? 126
  const effectiveSpread = spreadDegrees ?? (geometry.horizontal === 'center' ? 150 : 160)
  const center = centerAngle(geometry)
  const step = categories.length === 1 ? 0 : effectiveSpread / (categories.length - 1)
  const start = center - effectiveSpread / 2

  return categories.map((category, index) => {
    const angle = start + step * index
    const radians = (angle * Math.PI) / 180
    const x = geometry.orbX + Math.cos(radians) * baseRadius
    const y = geometry.orbY + Math.sin(radians) * baseRadius

    return createPlacement(category, index, x, y, angle, geometry)
  })
}

function createPlacement(
  category: PanelCategory,
  index: number,
  x: number,
  y: number,
  angle: number,
  geometry: OrbWindowGeometry,
): PetalPlacement {
  return {
    category,
    angle,
    x,
    y,
    delayMs: index * 42,
    style: {
      '--petal-x': `${x}px`,
      '--petal-y': `${y}px`,
      '--petal-delay': `${index * 42}ms`,
      '--petal-origin-x': `${geometry.orbX - x}px`,
      '--petal-origin-y': `${geometry.orbY - y}px`,
    } as CSSProperties,
  }
}

export function createOrbHitRegions(
  geometry: OrbWindowGeometry,
  petals: readonly PetalPlacement[],
): HitRegion[] {
  return [
    {
      id: 'orb',
      x: geometry.orbX - ORB_HIT_SIZE / 2,
      y: geometry.orbY - ORB_HIT_SIZE / 2,
      width: ORB_HIT_SIZE,
      height: ORB_HIT_SIZE,
    },
    ...petals.map((petal) => ({
      id: petal.category,
      x: petal.x - PETAL_WIDTH / 2,
      y: petal.y - PETAL_HEIGHT / 2,
      width: PETAL_WIDTH,
      height: PETAL_HEIGHT,
    })),
  ]
}

export function containsPoint(region: HitRegion, point: Point): boolean {
  return (
    point.x >= region.x &&
    point.x <= region.x + region.width &&
    point.y >= region.y &&
    point.y <= region.y + region.height
  )
}
