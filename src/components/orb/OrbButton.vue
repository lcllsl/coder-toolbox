<script setup lang="ts">
import { computed } from 'vue'
import { Sparkles, X } from '@lucide/vue'
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
  if (props.expanded) return '收回花瓣工具箱'
  const suffix = props.mode === 'paused' ? '（完全暂停）' : props.mode === 'silent' ? '（静默模式）' : ''
  return `展开花瓣工具箱${suffix}`
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
    <Sparkles v-else :size="25" :stroke-width="1.9" aria-hidden="true" />
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
  border: 1px solid color-mix(in srgb, var(--color-border) 72%, transparent);
  border-radius: var(--radius-pill);
  color: var(--color-on-accent);
  background:
    radial-gradient(circle at 32% 24%, rgb(255 255 255 / 45%), transparent 34%),
    linear-gradient(145deg, var(--color-orb-start), var(--color-orb-end));
  box-shadow: var(--shadow-orb);
  cursor: pointer;
  transition:
    transform var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);
  opacity: var(--orb-opacity, 1);
}

.orb-button:has(.reminder-dot) {
  animation: reminder-breathe 1.8s ease-in-out infinite;
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
}

.mode-dot { position: absolute; left: 4px; bottom: 4px; width: 9px; height: 9px; border: 2px solid rgb(255 255 255 / 82%); border-radius: 50%; background: #e5b14c; }.mode-dot.paused { background: #a8afbb; }

@keyframes reminder-breathe {
  50% { box-shadow: 0 5px 14px rgb(53 169 147 / 58%), 0 0 0 7px rgb(53 169 147 / 10%); }
}

.orb-button[aria-expanded='true'] svg {
  transform: rotate(45deg) scale(0.92);
}

.orb-button svg {
  transition: transform var(--duration-normal) var(--ease-standard);
}

.orb-button:hover {
  transform: translateY(-2px) rotate(-5deg);
  box-shadow: var(--shadow-orb-hover);
}

.orb-button:active {
  transform: scale(0.94);
}

.orb-button:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .orb-button {
    transition: opacity var(--duration-fast) linear;
  }

  .orb-button:hover,
  .orb-button:active {
    transform: none;
  }

  .orb-button:has(.reminder-dot) { animation: none; }
}
</style>
