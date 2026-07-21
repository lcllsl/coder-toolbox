import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { usePanelStore } from '@/app/stores/panel'

describe('panel store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    delete document.documentElement.dataset.theme
  })

  it('switches views and toggles category favorites', () => {
    const store = usePanelStore()

    store.selectView('dev-tools')
    store.toggleFavorite('dev-tools')
    expect(store.activeView).toBe('dev-tools')
    expect(store.favorites).toEqual(['dev-tools'])

    store.toggleFavorite('dev-tools')
    expect(store.favorites).toEqual([])
  })

  it('applies explicit themes and restores system mode', () => {
    const store = usePanelStore()

    store.setTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    store.setTheme('system')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })
})
