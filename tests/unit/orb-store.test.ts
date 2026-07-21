import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useOrbStore } from '@/app/stores/orb'

describe('orb state machine', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('accepts the normal petal opening sequence', () => {
    const store = useOrbStore()

    expect(store.transitionTo('petals-opening')).toBe(true)
    expect(store.transitionTo('petals-open')).toBe(true)
    expect(store.uiState).toBe('petals-open')
  })

  it('rejects transitions that would skip animation states', () => {
    const store = useOrbStore()

    expect(store.transitionTo('panel-open')).toBe(false)
    expect(store.uiState).toBe('idle')
  })
})
