export type SnapEdge = 'left' | 'right' | 'top' | 'bottom'
export type HorizontalExpansion = 'left' | 'center' | 'right'
export type VerticalExpansion = 'up' | 'center' | 'down'

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface OrbWindowGeometry {
  width: number
  height: number
  orbX: number
  orbY: number
  horizontal: HorizontalExpansion
  vertical: VerticalExpansion
}

export interface SnapResult {
  edge: SnapEdge
  x: number
  y: number
}

export interface HitRegion extends Rect {
  id: string
}
