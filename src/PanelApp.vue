<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Component } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { Clipboard, CodeXml, FolderOpen, HeartPulse, Settings, Zap } from '@lucide/vue'
import { useRouter } from 'vue-router'

import { useFeedbackStore } from '@/app/stores/feedback'
import { useClipboardStore } from '@/app/stores/clipboard'
import { usePanelStore, type PanelView } from '@/app/stores/panel'
import { useQuickActionsStore } from '@/app/stores/quick-actions'
import PanelShell from '@/components/panel/PanelShell.vue'
import UiToastHost from '@/components/ui/UiToastHost.vue'
import DeveloperToolsPanel from '@/features/dev-tools/components/DeveloperToolsPanel.vue'
import HealthPanel from '@/features/health/components/HealthPanel.vue'
import ClipboardPanel from '@/features/clipboard/components/ClipboardPanel.vue'
import FilesPanel from '@/features/files/components/FilesPanel.vue'
import QuickActionsPanel from '@/features/quick-actions/components/QuickActionsPanel.vue'
import SettingsPanel from '@/features/settings/components/SettingsPanel.vue'
import { closePanel, onPanelNavigate, showSettings } from '@/services/tauri/windows'
import { onClipboardHistoryChanged } from '@/services/tauri/clipboard'
import {
  CATEGORY_LABELS,
  CATEGORY_PRESENTATION,
  isPanelCategory,
  type PanelCategory,
} from '@/types/navigation'

const icons: Record<PanelCategory, Component> = {
  health: HeartPulse,
  clipboard: Clipboard,
  'dev-tools': CodeXml,
  files: FolderOpen,
  'quick-actions': Zap,
}

const panelStore = usePanelStore()
const clipboardStore = useClipboardStore()
const feedback = useFeedbackStore()
const quickActions = useQuickActionsStore()
const router = useRouter()
const closing = ref(false)
const previewCloseMode = ref('')
const activeCategory = computed(() =>
  isPanelCategory(panelStore.activeView) ? panelStore.activeView : null,
)
const title = computed(() =>
  panelStore.activeView === 'settings' ? '设置' : CATEGORY_LABELS[panelStore.activeView],
)
const presentation = computed(() =>
  activeCategory.value ? CATEGORY_PRESENTATION[activeCategory.value] : null,
)
const activeIcon = computed(() =>
  activeCategory.value ? icons[activeCategory.value] : Settings,
)
const isFavorite = computed(() =>
  activeCategory.value ? panelStore.favorites.includes(activeCategory.value) : false,
)

let unlisten: UnlistenFn | undefined
let unlistenClipboardHistory: UnlistenFn | undefined

async function selectView(view: PanelView) {
  panelStore.selectView(view)
  const target = view === 'settings' ? '/settings' : `/category/${view}`
  if (router.currentRoute.value.path !== target) await router.replace(target)
  if (view !== 'settings' && view !== 'quick-actions') {
    await quickActions.recordRecent(`category:${view}`, CATEGORY_LABELS[view], view)
  }
}

async function finishPanel(reopenPetals: boolean) {
  if (closing.value) return
  closing.value = true
  try {
    await closePanel(reopenPetals)
  } finally {
    window.setTimeout(() => {
      closing.value = false
    }, 240)
  }
}

async function toggleFavorite() {
  const category = activeCategory.value
  if (!category) return
  const wasFavorite = panelStore.favorites.includes(category)
  await panelStore.toggleFavorite(category)
  feedback.notify(wasFavorite ? '已取消收藏' : '已收藏当前分类', wasFavorite ? 'neutral' : 'success')
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  void finishPanel(false)
}

function handlePreviewClose(event: Event) {
  previewCloseMode.value = (event as CustomEvent<{ reopenPetals: boolean }>).detail.reopenPetals
    ? 'back'
    : 'close'
}

onMounted(async () => {
  await panelStore.initialize()
  await clipboardStore.initialize(false)
  unlistenClipboardHistory = await onClipboardHistoryChanged(() => void clipboardStore.reload())
  unlisten = await onPanelNavigate(({ category }) => {
    if (category === 'settings' || isPanelCategory(category)) void selectView(category)
  })
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('panel:preview-close', handlePreviewClose)
})

onUnmounted(() => {
  unlisten?.()
  unlistenClipboardHistory?.()
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('panel:preview-close', handlePreviewClose)
})
</script>

<template>
  <main
    class="panel-stage"
    :class="{ closing }"
    :data-view="panelStore.activeView"
    :data-preview-close="previewCloseMode"
  >
    <PanelShell
      :title="title"
      :accent="presentation?.accent"
      :favorite="isFavorite"
      :show-favorite="Boolean(activeCategory)"
      :show-settings="panelStore.activeView !== 'settings'"
      @back="finishPanel(true)"
      @close="finishPanel(false)"
      @settings="showSettings"
      @favorite="toggleFavorite"
    >
      <template #icon>
        <component :is="activeIcon" :size="20" :stroke-width="1.8" />
      </template>

      <Transition name="view" mode="out-in">
        <DeveloperToolsPanel v-if="activeCategory === 'dev-tools'" key="dev-tools" />

        <HealthPanel v-else-if="activeCategory === 'health'" key="health" />

        <ClipboardPanel v-else-if="activeCategory === 'clipboard'" key="clipboard" />

        <FilesPanel v-else-if="activeCategory === 'files'" key="files" />

        <QuickActionsPanel v-else-if="activeCategory === 'quick-actions'" key="quick-actions" @navigate="selectView" />

        <SettingsPanel v-else key="settings" />
      </Transition>
    </PanelShell>
    <UiToastHost />
  </main>
</template>

<style scoped>
.panel-stage {
  position: fixed;
  inset: 0;
  padding: 12px;
  transition: opacity var(--duration-normal), transform var(--duration-normal);
}

.panel-stage.closing { opacity: 0; transform: scale(0.975) translateY(6px); }

.view-enter-active,
.view-leave-active { transition: opacity 180ms var(--ease-standard), transform 180ms var(--ease-standard); }
.view-enter-from { opacity: 0; transform: translateX(10px); }
.view-leave-to { opacity: 0; transform: translateX(-8px); }

</style>
