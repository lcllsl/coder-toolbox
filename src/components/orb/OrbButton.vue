<script setup lang="ts">
import { computed } from 'vue'
import { X } from '@lucide/vue'
import maopaoIcon from '@/assets/branding/maopao-orb.png'
import type { AppMode } from '@/features/settings/types'

const props = defineProps<{
  expanded: boolean
  panelOpen?: boolean
  reminderActive?: boolean
  mode?: AppMode
}>()

const label = computed(() => {
  if (props.panelOpen) return '关闭功能面板'
  if (props.reminderActive) return '查看健康提醒'
  if (props.expanded) return '收回冒泡'
  const suffix = props.mode === 'paused' ? '（完全暂停）' : props.mode === 'silent' ? '（静默模式）' : ''
  return `展开冒泡${suffix}`
})

const emit = defineEmits<{
  keyboardActivate: []
  pointerStart: [event: PointerEvent]
  pointerMove: [event: PointerEvent]
  pointerEnd: [event: PointerEvent]
}>()
</script>

<template>
  <button
    class="orb-button"
    type="button"
    :aria-expanded="expanded"
    :aria-label="label"
    @click="$event.detail === 0 && emit('keyboardActivate')"
    @pointerdown="emit('pointerStart', $event)"
    @pointermove="emit('pointerMove', $event)"
    @pointerup="emit('pointerEnd', $event)"
    @pointercancel="emit('pointerEnd', $event)"
  >
    <X v-if="panelOpen" :size="25" :stroke-width="1.9" aria-hidden="true" />
    <img v-else class="orb-logo" :src="maopaoIcon" alt="" aria-hidden="true" />
    <span v-if="reminderActive" class="reminder-dot" aria-hidden="true" />
    <span v-if="mode !== 'work'" class="mode-dot" :class="mode" aria-hidden="true" />
  </button>
</template>

<style scoped>
.orb-button {
  position: relative;
  width: var(--orb-size);
  height: var(--orb-size);
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-pill);
  color: var(--color-on-accent);
  background: transparent;
  box-shadow: none;
  cursor: pointer;
  transition:
    transform var(--duration-fast) var(--ease-standard);
  opacity: var(--orb-opacity, 1);
}

.orb-button:has(> svg) {
  background: linear-gradient(145deg, var(--color-orb-start), var(--color-orb-end));
}

.reminder-dot {
  position: absolute;
  right: 4px;
  top: 4px;
  width: 9px;
  height: 9px;
  border: 2px solid rgb(255 255 255 / 82%);
  border-radius: 50%;
  background: #58d9b9;
  animation: reminder-breathe 1.8s ease-in-out infinite;
}

.mode-dot { position: absolute; left: 4px; bottom: 4px; width: 9px; height: 9px; border: 2px solid rgb(255 255 255 / 82%); border-radius: 50%; background: #e5b14c; }.mode-dot.paused { background: #a8afbb; }

@keyframes reminder-breathe {
  50% { transform: scale(1.18); opacity: 0.72; }
}

.orb-button[aria-expanded='true'] .orb-logo {
  transform: rotate(45deg) scale(0.92);
}

.orb-button svg,
.orb-logo {
  transition: transform var(--duration-normal) var(--ease-standard);
}

.orb-logo {
  width: 118%;
  height: 118%;
  max-width: none;
  object-fit: contain;
  pointer-events: none;
}

.orb-button:hover {
  transform: translateY(-2px) rotate(-5deg);
}

.orb-button:active {
  transform: scale(0.94);
}

.orb-button:focus-visible {
  outline: none;
}

.orb-button:focus-visible .orb-logo {
  filter: brightness(1.12);
  transform: scale(1.04);
}

@media (prefers-reduced-motion: reduce) {
  .orb-button {
    transition: opacity var(--duration-fast) linear;
  }

  .orb-button:hover,
  .orb-button:active {
    transform: none;
  }

  .reminder-dot { animation: none; }
}
</style>
