import { createPinia } from 'pinia'
import { createApp } from 'vue'

import OrbApp from './OrbApp.vue'
import PanelApp from './PanelApp.vue'
import { router } from './app/router'
import './app/theme/tokens.css'
import './app/theme/global.css'
import { getAppWindowLabel } from './services/tauri/runtime'

const rootComponent = getAppWindowLabel() === 'panel-window' ? PanelApp : OrbApp

createApp(rootComponent).use(createPinia()).use(router).mount('#app')
