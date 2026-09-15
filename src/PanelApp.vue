<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Component } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { BriefcaseBusiness, Clipboard, FolderOpen, HeartPulse, Settings, Sparkles } from '@lucide/vue'
import { useRouter } from 'vue-router'

import { useFeedbackStore } from '@/app/stores/feedback'
import { useClipboardStore } from '@/app/stores/clipboard'
import { usePanelStore, type PanelView } from '@/app/stores/panel'
import { useQuickActionsStore } from '@/app/stores/quick-actions'
import PanelShell from '@/components/panel/PanelShell.vue'
import UiToastHost from '@/components/ui/UiToastHost.vue'
import AiOfficePanel from '@/features/ai-office/components/AiOfficePanel.vue'
import HealthPanel from '@/features/health/components/HealthPanel.vue'
import ClipboardPanel from '@/features/clipboard/components/ClipboardPanel.vue'
import FilesPanel from '@/features/files/components/FilesPanel.vue'
import QuickActionsPanel from '@/features/quick-actions/components/QuickActionsPanel.vue'
import SettingsPanel from '@/features/settings/components/SettingsPanel.vue'
import {
  closePanel,
  hidePanel,
  onPanelNavigate,
  onPanelPreviewHide,
  showSettings,
} from '@/services/tauri/windows'
import { onClipboardHistoryChanged } from '@/services/tauri/clipboard'
import {
  CATEGORY_LABELS,
  CATEGORY_PRESENTATION,
  normalizePanelCategory,
  type PanelCategory,
} from '@/types/navigation'

const icons: Record<PanelCategory, Component> = {
  'ai-office': Sparkles,
  health: HeartPulse,
  clipboard: Clipboard,
  files: FolderOpen,
  'quick-actions': BriefcaseBusiness,
}

const panelStore = usePanelStore()
const clipboardStore = useClipboardStore()
const feedback = useFeedbackStore()
const quickActions = useQuickActionsStore()
const router = useRouter()
const closing = ref(false)
const previewCloseMode = ref('')
const previewHidden = ref(false)
const quickInitialView = ref<'overview' | 'tools'>('overview')
const quickPanelKey = ref(0)
const activeCategory = computed(() =>
  panelStore.activeView !== 'settings' ? panelStore.activeView : null,
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
let unlistenPreviewHide: UnlistenFn | undefined

async function selectView(view: PanelView, quickView: 'overview' | 'tools' = 'overview') {
  if (view === 'quick-actions') {
    quickInitialView.value = quickView
    quickPanelKey.value += 1
  }
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

async function hideCurrentPanel() {
  if (closing.value) return
  closing.value = true
  try {
    await hidePanel()
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
  void hideCurrentPanel()
}

function handlePreviewClose(event: Event) {
  previewCloseMode.value = (event as CustomEvent<{ reopenPetals: boolean }>).detail.reopenPetals
    ? 'back'
    : 'close'
}

function handlePreviewHide() {
  previewHidden.value = true
}

onMounted(async () => {
  await panelStore.initialize()
  await clipboardStore.initialize(false)
  unlistenClipboardHistory = await onClipboardHistoryChanged(() => void clipboardStore.reload())
  unlisten = await onPanelNavigate(({ category }) => {
    if (category === 'settings') void selectView(category)
    else {
      const normalized = normalizePanelCategory(category)
      if (normalized) void selectView(normalized, category === 'dev-tools' ? 'tools' : 'overview')
    }
  })
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('panel:preview-close', handlePreviewClose)
  unlistenPreviewHide = onPanelPreviewHide(handlePreviewHide)
})

onUnmounted(() => {
  unlisten?.()
  unlistenClipboardHistory?.()
  unlistenPreviewHide?.()
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
    :data-preview-hidden="previewHidden"
  >
    <PanelShell
      :title="title"
      :summary="presentation?.summary"
      :accent="presentation?.accent"
      :favorite="isFavorite"
      :show-favorite="Boolean(activeCategory)"
      :show-settings="panelStore.activeView !== 'settings'"
      @back="finishPanel(true)"
      @hide="hideCurrentPanel"
      @settings="showSettings"
      @favorite="toggleFavorite"
    >
      <template #icon>
        <component :is="activeIcon" :size="20" :stroke-width="1.8" />
      </template>

      <div :key="activeCategory === 'quick-actions' ? `quick-${quickPanelKey}` : panelStore.activeView" class="panel-view">
        <AiOfficePanel v-if="activeCategory === 'ai-office'" />

        <HealthPanel v-else-if="activeCategory === 'health'" />

        <ClipboardPanel v-else-if="activeCategory === 'clipboard'" />

        <FilesPanel v-else-if="activeCategory === 'files'" />

        <QuickActionsPanel v-else-if="activeCategory === 'quick-actions'" :initial-view="quickInitialView" @navigate="selectView" />

        <SettingsPanel v-else />
      </div>
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
.panel-view { min-height: 100%; }

</style>
