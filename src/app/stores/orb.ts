import { defineStore } from 'pinia'

import type { OrbWindowGeometry, SnapEdge } from '@/types/orb'

export type OrbUiState =
  | 'idle'
  | 'dragging'
  | 'petals-opening'
  | 'petals-open'
  | 'petals-closing'
  | 'panel-opening'
  | 'panel-open'
  | 'panel-closing'
  | 'reminder'

const allowedTransitions: Record<OrbUiState, readonly OrbUiState[]> = {
  idle: ['dragging', 'petals-opening', 'panel-opening', 'reminder'],
  dragging: ['idle'],
  'petals-opening': ['petals-open', 'petals-closing'],
  'petals-open': ['petals-closing', 'panel-opening', 'dragging'],
  'petals-closing': ['idle', 'petals-opening'],
  'panel-opening': ['panel-open', 'petals-open'],
  'panel-open': ['panel-closing'],
  'panel-closing': ['idle', 'petals-opening'],
  reminder: ['idle', 'petals-opening'],
}

export const useOrbStore = defineStore('orb', {
  state: () => ({
    uiState: 'idle' as OrbUiState,
    geometry: null as OrbWindowGeometry | null,
    snappedEdge: 'right' as SnapEdge,
    edgeCollapsed: false,
  }),
  getters: {
    isTransitioning: (state) =>
      state.uiState === 'petals-opening' ||
      state.uiState === 'petals-closing' ||
      state.uiState === 'panel-opening' ||
      state.uiState === 'panel-closing',
  },
  actions: {
    transitionTo(nextState: OrbUiState): boolean {
      if (!allowedTransitions[this.uiState].includes(nextState)) return false
      this.uiState = nextState
      return true
    },
    setGeometry(geometry: OrbWindowGeometry | null) {
      this.geometry = geometry
    },
    setSnappedEdge(edge: SnapEdge) {
      this.snappedEdge = edge
    },
    setEdgeCollapsed(collapsed: boolean) {
      this.edgeCollapsed = collapsed
    },
  },
})
