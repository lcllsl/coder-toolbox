import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { usePanelStore } from '@/app/stores/panel'

describe('panel store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('switches views and toggles category favorites', () => {
    const store = usePanelStore()

    store.selectView('quick-actions')
    store.toggleFavorite('quick-actions')
    expect(store.activeView).toBe('quick-actions')
    expect(store.favorites).toEqual(['quick-actions'])

    store.toggleFavorite('quick-actions')
    expect(store.favorites).toEqual([])
  })

  it('applies explicit themes and restores system mode', () => {
    const store = usePanelStore()

    store.setTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    store.setTheme('system')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('maps legacy developer-tool favorites without duplicating efficiency tools', async () => {
    localStorage.setItem('petal-toolbox.panel-preferences', JSON.stringify({
      theme: 'system',
      favorites: ['dev-tools', 'quick-actions'],
    }))
    const store = usePanelStore()

    await store.initialize()

    expect(store.favorites).toEqual(['quick-actions'])
  })
})
