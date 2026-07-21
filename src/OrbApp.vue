<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'

import { useHealthStore } from '@/app/stores/health'
import { useClipboardStore } from '@/app/stores/clipboard'
import { useFilesStore } from '@/app/stores/files'
import { useOrbStore } from '@/app/stores/orb'
import { useSettingsStore } from '@/app/stores/settings'
import OrbButton from '@/components/orb/OrbButton.vue'
import PetalPlaceholder from '@/components/petals/PetalPlaceholder.vue'
import ReminderCard from '@/features/health/components/ReminderCard.vue'
import { computeReminderCardRegion } from '@/features/health/core/reminder-layout'
import { onHealthDebugTrigger, onHealthSettingsChanged } from '@/services/tauri/health'
import { onClipboardSettingsChanged } from '@/services/tauri/clipboard'
import { onAppSettingsChanged, onGlobalShortcut, onTrayModeRequested, updateTrayMode } from '@/services/tauri/settings'
import type { AppMode } from '@/features/settings/types'
import {
  closePanel,
  getOrbPosition,
  moveOrbTo,
  onOrbPanelClosed,
  openPanel,
  setOrbEdgeCollapsed,
  setOrbExpanded,
  snapOrbToEdge,
  startOrbHitTest,
} from '@/services/tauri/windows'
import type { Point } from '@/types/orb'
import { PANEL_CATEGORIES, type PanelCategory } from '@/types/navigation'
import { computePetalLayout, createOrbHitRegions } from '@/utils/petal-layout'

const DRAG_THRESHOLD = 5
const EDGE_COLLAPSE_DELAY = 3_000
const OPEN_DURATION = 430
const CLOSE_DURATION = 300

interface DragSession {
  pointerId: number
  startPointer: Point
  startWindow: Point | null
  dragging: boolean
  canDrag: boolean
}

const orbStore = useOrbStore()
const healthStore = useHealthStore()
const clipboardStore = useClipboardStore()
const settingsStore = useSettingsStore()
const filesStore = useFilesStore()
const renderPetals = ref(false)
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const transitionDuration = (duration: number) => (reducedMotion ? 20 : duration)
const fallbackGeometry = {
  width: 88,
  height: 88,
  orbX: 44,
  orbY: 44,
  horizontal: 'left' as const,
  vertical: 'center' as const,
}
const geometry = computed(() => orbStore.geometry ?? fallbackGeometry)
const petals = computed(() =>
  computePetalLayout({ geometry: geometry.value, categories: PANEL_CATEGORIES }),
)
const reminderRegion = computed(() =>
  healthStore.cardVisible && orbStore.geometry ? computeReminderCardRegion(geometry.value) : null,
)
const hitRegions = computed(() => [
  ...createOrbHitRegions(geometry.value, renderPetals.value ? petals.value : []),
  ...(reminderRegion.value ? [reminderRegion.value] : []),
])
const expanded = computed(() =>
  ['petals-opening', 'petals-open', 'petals-closing', 'panel-opening'].includes(orbStore.uiState),
)
const panelOpen = computed(() =>
  ['panel-opening', 'panel-open', 'panel-closing'].includes(orbStore.uiState),
)
const stageStyle = computed(() => ({
  '--orb-x': `${geometry.value.orbX}px`,
  '--orb-y': `${geometry.value.orbY}px`,
  '--orb-size': `${settingsStore.settings.orbSize}px`,
  '--orb-opacity': settingsStore.settings.orbOpacity,
}))

let dragSession: DragSession | null = null
let edgeTimer: number | undefined
let transitionTimer: number | undefined
let stopHitTest: (() => void) | undefined
let unlistenPanelClosed: (() => void) | undefined
let unlistenHealthSettings: (() => void) | undefined
let unlistenHealthDebug: (() => void) | undefined
let unlistenClipboardSettings: (() => void) | undefined
let unlistenAppSettings: (() => void) | undefined
let unlistenTrayMode: (() => void) | undefined
let unlistenGlobalShortcut: (() => void) | undefined
let pendingMove: Point | null = null
let moving = false
let edgeTransition: Promise<void> | null = null
let healthTimer: number | undefined
let reminderCardTimer: number | undefined
let lastHealthTickAt = Date.now()
let clickTimer: number | undefined

function clearTransitionTimer() {
  if (transitionTimer !== undefined) window.clearTimeout(transitionTimer)
  transitionTimer = undefined
}

function clearEdgeTimer() {
  if (edgeTimer !== undefined) window.clearTimeout(edgeTimer)
  edgeTimer = undefined
}

function clearReminderCardTimer() {
  if (reminderCardTimer !== undefined) window.clearTimeout(reminderCardTimer)
  reminderCardTimer = undefined
}

function clearClickTimer() {
  if (clickTimer !== undefined) window.clearTimeout(clickTimer)
  clickTimer = undefined
}

function scheduleEdgeCollapse() {
  clearEdgeTimer()
  if (orbStore.uiState !== 'idle' || orbStore.edgeCollapsed) return
  edgeTimer = window.setTimeout(async () => {
    if (orbStore.uiState !== 'idle') return
    if (edgeTransition) await edgeTransition
    if (orbStore.uiState !== 'idle' || orbStore.edgeCollapsed) return
    edgeTransition = setOrbEdgeCollapsed(orbStore.snappedEdge, true)
    try {
      await edgeTransition
      orbStore.setEdgeCollapsed(true)
    } finally {
      edgeTransition = null
    }
  }, EDGE_COLLAPSE_DELAY)
}

async function restoreFromEdge() {
  clearEdgeTimer()
  if (edgeTransition) await edgeTransition
  if (!orbStore.edgeCollapsed) return
  edgeTransition = setOrbEdgeCollapsed(orbStore.snappedEdge, false)
  try {
    await edgeTransition
    orbStore.setEdgeCollapsed(false)
  } finally {
    edgeTransition = null
  }
}

function enableExpandedHitTest() {
  stopHitTest?.()
  stopHitTest = startOrbHitTest(() => hitRegions.value)
}

function disableExpandedHitTest() {
  stopHitTest?.()
  stopHitTest = undefined
}

async function openPetalsFromCurrentState() {
  if (!orbStore.transitionTo('petals-opening')) return
  await restoreFromEdge()
  try {
    const nextGeometry = await setOrbExpanded(true, undefined, orbStore.snappedEdge)
    orbStore.setGeometry(nextGeometry)
    renderPetals.value = true
    await nextTick()
    enableExpandedHitTest()
    transitionTimer = window.setTimeout(() => {
      orbStore.transitionTo('petals-open')
    }, transitionDuration(OPEN_DURATION))
  } catch (error) {
    renderPetals.value = false
    orbStore.setGeometry(null)
    orbStore.transitionTo('petals-closing')
    orbStore.transitionTo('idle')
    scheduleEdgeCollapse()
    console.error('Unable to expand orb window', error)
  }
}

async function openReminderCard() {
  if (!healthStore.activeReminder || !healthStore.cardVisible) return
  if (orbStore.uiState !== 'idle' && orbStore.uiState !== 'reminder') return
  if (orbStore.uiState === 'idle' && !orbStore.transitionTo('reminder')) return
  await restoreFromEdge()
  if (!orbStore.geometry) {
    const nextGeometry = await setOrbExpanded(true, undefined, orbStore.snappedEdge)
    orbStore.setGeometry(nextGeometry)
  }
  await nextTick()
  enableExpandedHitTest()
  clearReminderCardTimer()
  reminderCardTimer = window.setTimeout(() => void autoHideReminder(), 30_000)
}

async function closeReminderWindow() {
  clearReminderCardTimer()
  disableExpandedHitTest()
  if (orbStore.geometry) await setOrbExpanded(false, orbStore.geometry)
  orbStore.setGeometry(null)
  if (orbStore.uiState === 'reminder') orbStore.transitionTo('idle')
  scheduleEdgeCollapse()
}

async function runHealthTick() {
  const now = new Date()
  const resumedAfterSleep = now.getTime() - lastHealthTickAt > 30_000
  lastHealthTickAt = now.getTime()
  await healthStore.tick(now, resumedAfterSleep)
  if (healthStore.cardVisible) await openReminderCard()
}

async function completeReminder() {
  await healthStore.completeActive()
  if (healthStore.cardVisible) await openReminderCard()
  else await closeReminderWindow()
}

async function snoozeReminder() {
  await healthStore.snoozeActive()
  if (healthStore.cardVisible) await openReminderCard()
  else await closeReminderWindow()
}

async function autoHideReminder() {
  await healthStore.autoHideActive()
  await closeReminderWindow()
}

async function closePetals() {
  if (!orbStore.transitionTo('petals-closing')) return
  clearTransitionTimer()
  disableExpandedHitTest()
  renderPetals.value = false
  await new Promise((resolve) => window.setTimeout(resolve, transitionDuration(CLOSE_DURATION)))
  await setOrbExpanded(false, orbStore.geometry)
  orbStore.setGeometry(null)
  orbStore.transitionTo('idle')
  scheduleEdgeCollapse()
}

async function handleOrbClick() {
  if (orbStore.isTransitioning || orbStore.uiState === 'dragging') return

  if (orbStore.uiState === 'panel-open') {
    orbStore.transitionTo('panel-closing')
    await closePanel(false)
    return
  }
  if (orbStore.uiState === 'petals-open') {
    await closePetals()
    return
  }
  if (orbStore.uiState === 'reminder' || (healthStore.pendingCount > 0 && orbStore.uiState === 'idle')) {
    healthStore.showPendingCard()
    await openReminderCard()
    return
  }
  if (orbStore.uiState === 'idle' || orbStore.uiState === 'reminder') {
    await openPetalsFromCurrentState()
  }
}

async function handleOrbTap() {
  const action = settingsStore.settings.doubleClickAction
  if (action === 'none' || orbStore.uiState !== 'idle') {
    await handleOrbClick()
    return
  }
  if (clickTimer !== undefined) {
    clearClickTimer()
    const category = action === 'quick-actions' ? 'quick-actions' : action
    await selectCategory(category)
    return
  }
  clickTimer = window.setTimeout(() => {
    clickTimer = undefined
    void handleOrbClick()
  }, 280)
}

async function applyRuntimeMode(mode: AppMode) {
  const silent = mode !== 'work'
  const paused = mode === 'paused'
  const updates: Promise<void>[] = []
  if (healthStore.settings.silentMode !== silent) updates.push(healthStore.setSilentMode(silent))
  if (clipboardStore.settings.paused !== paused) updates.push(clipboardStore.setPaused(paused))
  await Promise.all(updates)
  if (mode === 'paused') {
    healthStore.hidePendingCard()
    if (orbStore.uiState === 'reminder') await closeReminderWindow()
  }
}

async function selectCategory(category: PanelCategory) {
  if (!orbStore.transitionTo('panel-opening')) return
  clearTransitionTimer()
  disableExpandedHitTest()
  renderPetals.value = false

  try {
    await new Promise((resolve) => window.setTimeout(resolve, transitionDuration(190)))
    await setOrbExpanded(false, orbStore.geometry)
    orbStore.setGeometry(null)
    await openPanel(category)
    orbStore.transitionTo('panel-open')
  } catch (error) {
    const nextGeometry = await setOrbExpanded(true, undefined, orbStore.snappedEdge)
    orbStore.setGeometry(nextGeometry)
    renderPetals.value = true
    enableExpandedHitTest()
    orbStore.transitionTo('petals-open')
    console.error('Unable to open panel window', error)
  }
}

async function queueWindowMove(position: Point) {
  pendingMove = position
  if (moving) return
  moving = true
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  const nextPosition = pendingMove
  pendingMove = null
  if (nextPosition) await moveOrbTo(nextPosition)
  moving = false
  if (pendingMove) void queueWindowMove(pendingMove)
}

function handlePointerStart(event: PointerEvent) {
  if (event.button !== 0 || orbStore.isTransitioning || orbStore.uiState === 'dragging') return
  clearEdgeTimer()
  const canDrag = orbStore.uiState === 'idle'
  dragSession = {
    pointerId: event.pointerId,
    startPointer: { x: event.screenX, y: event.screenY },
    startWindow: null,
    dragging: false,
    canDrag,
  }
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId)
  void getOrbPosition().then((position) => {
    if (dragSession?.pointerId === event.pointerId) dragSession.startWindow = position
  })
}

function handlePointerMove(event: PointerEvent) {
  if (!dragSession || dragSession.pointerId !== event.pointerId) return
  if (!dragSession.canDrag) return
  const delta = {
    x: event.screenX - dragSession.startPointer.x,
    y: event.screenY - dragSession.startPointer.y,
  }
  if (!dragSession.dragging && Math.hypot(delta.x, delta.y) <= DRAG_THRESHOLD) return
  if (!dragSession.dragging) {
    dragSession.dragging = true
    orbStore.setEdgeCollapsed(false)
    orbStore.transitionTo('dragging')
  }
  if (!dragSession.startWindow) return
  void queueWindowMove({
    x: dragSession.startWindow.x + delta.x,
    y: dragSession.startWindow.y + delta.y,
  })
}

async function handlePointerEnd(event: PointerEvent) {
  if (!dragSession || dragSession.pointerId !== event.pointerId) return
  const didDrag = dragSession.dragging
  dragSession = null
  ;(event.currentTarget as HTMLElement | null)?.releasePointerCapture(event.pointerId)
  if (!didDrag) {
    await handleOrbTap()
    return
  }

  const snap = await snapOrbToEdge()
  orbStore.setSnappedEdge(snap.edge)
  orbStore.transitionTo('idle')
  scheduleEdgeCollapse()
}

async function handlePanelClosed(reopenPetals: boolean) {
  if (orbStore.uiState === 'panel-open') orbStore.transitionTo('panel-closing')
  if (reopenPetals) {
    await openPetalsFromCurrentState()
  } else {
    orbStore.transitionTo('idle')
    if (healthStore.cardVisible) await openReminderCard()
    else scheduleEdgeCollapse()
  }
}

function handleWindowBlur() {
  if (orbStore.uiState === 'petals-open') void closePetals()
}

onMounted(async () => {
  await settingsStore.initialize()
  await clipboardStore.initialize(false)
  void filesStore.initialize().catch(() => undefined)
  unlistenClipboardSettings = await onClipboardSettingsChanged(() => void clipboardStore.reloadSettings())
  unlistenPanelClosed = await onOrbPanelClosed((reopenPetals, debugReminderId) => {
    if (debugReminderId) healthStore.triggerDebugReminder(debugReminderId)
    void handlePanelClosed(reopenPetals)
  })
  const initialSnap = await snapOrbToEdge()
  orbStore.setSnappedEdge(initialSnap.edge)
  scheduleEdgeCollapse()
  window.addEventListener('blur', handleWindowBlur)
  await healthStore.initialize()
  await applyRuntimeMode(settingsStore.settings.mode)
  clipboardStore.startPolling()
  await updateTrayMode(settingsStore.settings.mode)
  unlistenAppSettings = await onAppSettingsChanged(async () => {
    await settingsStore.reload()
    await applyRuntimeMode(settingsStore.settings.mode)
  })
  unlistenTrayMode = await onTrayModeRequested(async (mode) => {
    await settingsStore.setMode(mode)
  })
  unlistenGlobalShortcut = await onGlobalShortcut(() => void handleOrbClick())
  unlistenHealthSettings = await onHealthSettingsChanged(() => void healthStore.reloadSettings())
  unlistenHealthDebug = await onHealthDebugTrigger((reminderId) => {
    healthStore.triggerDebugReminder(reminderId)
    void openReminderCard()
  })
  await runHealthTick()
  healthTimer = window.setInterval(() => void runHealthTick(), 15_000)
})

onUnmounted(() => {
  clearEdgeTimer()
  clearTransitionTimer()
  clearReminderCardTimer()
  clearClickTimer()
  if (healthTimer !== undefined) window.clearInterval(healthTimer)
  disableExpandedHitTest()
  unlistenPanelClosed?.()
  unlistenHealthSettings?.()
  unlistenHealthDebug?.()
  unlistenClipboardSettings?.()
  unlistenAppSettings?.()
  unlistenTrayMode?.()
  unlistenGlobalShortcut?.()
  clipboardStore.stopPolling()
  window.removeEventListener('blur', handleWindowBlur)
})
</script>

<template>
  <main
    class="orb-stage"
    :class="[`state-${orbStore.uiState}`, `mode-${settingsStore.settings.mode}`]"
    :style="stageStyle"
    @pointerenter="restoreFromEdge"
    @pointerleave="scheduleEdgeCollapse"
  >
    <TransitionGroup name="petal">
      <div
        v-for="petal in renderPetals ? petals : []"
        :key="petal.category"
        class="petal-position"
        :style="petal.style"
      >
        <PetalPlaceholder
          :category="petal.category"
          :label-above="geometry.horizontal === 'center' && geometry.vertical === 'up'"
          @select="selectCategory"
        />
      </div>
    </TransitionGroup>

    <Transition name="reminder-card">
      <div
        v-if="healthStore.cardVisible && healthStore.activeReminder && reminderRegion"
        class="reminder-position"
        :style="{ left: `${reminderRegion.x}px`, top: `${reminderRegion.y}px` }"
      >
        <ReminderCard
          :reminder="healthStore.activeReminder"
          :pending-count="healthStore.pendingCount"
          @complete="completeReminder"
          @snooze="snoozeReminder"
        />
      </div>
    </Transition>

    <div class="orb-position">
      <OrbButton
        :expanded="expanded"
        :panel-open="panelOpen"
        :reminder-active="healthStore.pendingCount > 0"
        :mode="settingsStore.settings.mode"
        @keyboard-activate="handleOrbClick"
        @pointer-start="handlePointerStart"
        @pointer-move="handlePointerMove"
        @pointer-end="handlePointerEnd"
      />
    </div>
  </main>
</template>

<style scoped>
.orb-stage {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  pointer-events: none;
}

.orb-position {
  position: absolute;
  left: var(--orb-x);
  top: var(--orb-y);
  z-index: 10;
  transform: translate(-50%, -50%);
  pointer-events: auto;
}

.state-dragging .orb-position {
  cursor: grabbing;
  transform: translate(-50%, -50%) scale(1.04);
}

.state-idle .orb-position :deep(.orb-button) {
  cursor: grab;
}

.state-dragging .orb-position :deep(.orb-button) {
  cursor: grabbing;
}

.petal-position {
  position: absolute;
  left: var(--petal-x);
  top: var(--petal-y);
  z-index: 5;
  transform: translate(-50%, -50%);
  transition:
    transform 420ms var(--ease-standard) var(--petal-delay),
    opacity 300ms var(--ease-standard) var(--petal-delay),
    filter 300ms var(--ease-standard) var(--petal-delay);
  pointer-events: auto;
}

.reminder-position {
  position: absolute;
  z-index: 3;
  pointer-events: auto;
}

.reminder-card-enter-active,
.reminder-card-leave-active {
  transition: opacity 240ms var(--ease-standard), transform 280ms var(--ease-standard);
}

.reminder-card-enter-from,
.reminder-card-leave-to {
  opacity: 0;
  transform: translateY(7px) scale(0.94);
}

.petal-enter-from,
.petal-leave-to {
  opacity: 0;
  filter: blur(4px);
  transform:
    translate(
      calc(-50% + var(--petal-origin-x)),
      calc(-50% + var(--petal-origin-y))
    )
    scale(0.3);
}

.petal-leave-active {
  transition-duration: 260ms;
  transition-delay: 0ms;
}

@media (prefers-reduced-motion: reduce) {
  .petal-position {
    transition: opacity 100ms linear;
  }

  .petal-enter-from,
  .petal-leave-to {
    filter: none;
    transform: translate(-50%, -50%);
  }
}
</style>
