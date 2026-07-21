import { describe, expect, it } from 'vitest'

import type { OrbWindowGeometry } from '@/types/orb'
import { PANEL_CATEGORIES } from '@/types/navigation'
import { computePetalLayout, containsPoint, createOrbHitRegions } from '@/utils/petal-layout'
import { computeReminderCardRegion } from '@/features/health/core/reminder-layout'

const baseGeometry: OrbWindowGeometry = {
  width: 340,
  height: 340,
  orbX: 290,
  orbY: 170,
  horizontal: 'left',
  vertical: 'center',
}

describe('petal layout', () => {
  it('places five petals on the side opposite the nearest horizontal edge', () => {
    const petals = computePetalLayout({ geometry: baseGeometry, categories: PANEL_CATEGORIES })

    expect(petals).toHaveLength(5)
    expect(petals.every((petal) => petal.x < baseGeometry.orbX)).toBe(true)
    expect(new Set(petals.map((petal) => `${petal.x.toFixed(2)}:${petal.y.toFixed(2)}`)).size).toBe(5)
  })

  it('biases the fan down when the orb is near the top edge', () => {
    const petals = computePetalLayout({
      geometry: { ...baseGeometry, orbY: 50, vertical: 'down' },
      categories: PANEL_CATEGORIES,
    })

    expect(petals.every((petal) => petal.y >= 50)).toBe(true)
  })

  it('keeps corner fan centers inside the expanded window', () => {
    const geometries: OrbWindowGeometry[] = [
      { ...baseGeometry, orbY: 44, vertical: 'down' },
      { ...baseGeometry, orbY: 296, vertical: 'up' },
      { ...baseGeometry, orbX: 44, orbY: 44, horizontal: 'right', vertical: 'down' },
      { ...baseGeometry, orbX: 44, orbY: 296, horizontal: 'right', vertical: 'up' },
    ]

    for (const geometry of geometries) {
      const petals = computePetalLayout({ geometry, categories: PANEL_CATEGORIES })
      expect(petals.every(({ x, y }) => x >= 0 && x <= 340 && y >= 0 && y <= 340)).toBe(true)
      for (let index = 1; index < petals.length; index += 1) {
        expect(
          Math.hypot(
            petals[index]!.x - petals[index - 1]!.x,
            petals[index]!.y - petals[index - 1]!.y,
          ),
        ).toBeGreaterThan(70)
      }
    }
  })

  it.each([
    {
      edge: 'top',
      geometry: {
        ...baseGeometry,
        orbX: 170,
        orbY: 44,
        horizontal: 'center' as const,
        vertical: 'down' as const,
      },
      direction: 1,
    },
    {
      edge: 'bottom',
      geometry: {
        ...baseGeometry,
        orbX: 170,
        orbY: 296,
        horizontal: 'center' as const,
        vertical: 'up' as const,
      },
      direction: -1,
    },
  ])('centers a semicircle inside the window for the $edge edge', ({ geometry, direction }) => {
    const petals = computePetalLayout({ geometry, categories: PANEL_CATEGORIES })

    expect(petals.every((petal) => (petal.y - geometry.orbY) * direction > 0)).toBe(true)
    expect(petals[2]!.x).toBeCloseTo(geometry.orbX)
    expect(petals[0]!.x + petals[4]!.x).toBeCloseTo(geometry.orbX * 2)
    expect(petals[1]!.x + petals[3]!.x).toBeCloseTo(geometry.orbX * 2)
    expect(petals.every(({ x, y }) => x >= 0 && x <= 340 && y >= 0 && y <= 340)).toBe(true)
    for (let index = 1; index < petals.length; index += 1) {
      expect(
        Math.hypot(
          petals[index]!.x - petals[index - 1]!.x,
          petals[index]!.y - petals[index - 1]!.y,
        ),
      ).toBeGreaterThan(70)
    }
  })

  it('builds hit regions for the orb and every petal', () => {
    const petals = computePetalLayout({ geometry: baseGeometry, categories: PANEL_CATEGORIES })
    const regions = createOrbHitRegions(baseGeometry, petals)

    expect(regions).toHaveLength(6)
    expect(containsPoint(regions[0]!, { x: baseGeometry.orbX, y: baseGeometry.orbY })).toBe(true)
    expect(containsPoint(regions[0]!, { x: 0, y: 0 })).toBe(false)
  })

  it('keeps reminder cards inside expanded windows on every edge', () => {
    const geometries: OrbWindowGeometry[] = [
      baseGeometry,
      { ...baseGeometry, orbX: 44, horizontal: 'right' },
      { ...baseGeometry, orbX: 170, orbY: 44, horizontal: 'center', vertical: 'down' },
      { ...baseGeometry, orbX: 170, orbY: 296, horizontal: 'center', vertical: 'up' },
    ]
    for (const geometry of geometries) {
      const region = computeReminderCardRegion(geometry)
      expect(region.x).toBeGreaterThanOrEqual(8)
      expect(region.y).toBeGreaterThanOrEqual(8)
      expect(region.x + region.width).toBeLessThanOrEqual(geometry.width - 8)
      expect(region.y + region.height).toBeLessThanOrEqual(geometry.height - 8)
    }
  })
})
