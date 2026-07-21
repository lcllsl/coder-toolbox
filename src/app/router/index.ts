import { createMemoryHistory, createRouter } from 'vue-router'

import { PANEL_CATEGORIES } from '@/types/navigation'

const routes = [
  {
    path: '/',
    redirect: `/category/${PANEL_CATEGORIES[0]}`,
  },
  {
    path: '/category/:category',
    name: 'category',
    component: { template: '<div />' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: { template: '<div />' },
  },
]

export const router = createRouter({
  history: createMemoryHistory(),
  routes,
})
