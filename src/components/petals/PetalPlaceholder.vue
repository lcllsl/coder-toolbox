<script setup lang="ts">
import { Clipboard, CodeXml, FolderOpen, HeartPulse, Zap } from '@lucide/vue'

import type { Component } from 'vue'
import type { PanelCategory } from '@/types/navigation'
import { CATEGORY_LABELS } from '@/types/navigation'

defineProps<{
  category: PanelCategory
  labelAbove?: boolean
}>()

const emit = defineEmits<{
  select: [category: PanelCategory]
}>()

const icons: Record<PanelCategory, Component> = {
  health: HeartPulse,
  clipboard: Clipboard,
  'dev-tools': CodeXml,
  files: FolderOpen,
  'quick-actions': Zap,
}
</script>

<template>
  <button
    class="petal"
    :class="{ 'label-above': labelAbove }"
    :data-category="category"
    type="button"
    @click="emit('select', category)"
  >
    <span class="petal-icon">
      <component :is="icons[category]" :size="23" :stroke-width="1.8" aria-hidden="true" />
    </span>
    <span class="petal-label">{{ CATEGORY_LABELS[category] }}</span>
  </button>
</template>

<style scoped>
.petal {
  width: 96px;
  height: 74px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 7px;
  padding: 0;
  border: 0;
  color: var(--color-text);
  background: transparent;
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
  transition:
    transform var(--duration-fast) var(--ease-standard);
  pointer-events: auto;
}

.petal-icon {
  width: 50px;
  height: 50px;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--petal-accent) 30%, var(--color-border));
  border-radius: 42% 58% 48% 52% / 55% 44% 56% 45%;
  color: var(--petal-accent);
  background:
    radial-gradient(circle at 32% 24%, rgb(255 255 255 / 64%), transparent 34%),
    color-mix(in srgb, var(--petal-accent) 12%, var(--color-surface));
  box-shadow: var(--shadow-sm);
  transition:
    transform var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard);
}

.petal-label {
  padding: 2px 7px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--color-surface) 92%, transparent);
  box-shadow: 0 3px 10px rgb(28 36 52 / 10%);
  font-size: 11.5px;
  line-height: 1.25;
}

.petal.label-above {
  flex-direction: column-reverse;
  justify-content: flex-end;
}

.petal:hover {
  transform: translateY(-2px);
}

.petal:hover .petal-icon {
  transform: rotate(-5deg) scale(1.06);
  background: color-mix(in srgb, var(--petal-accent) 19%, var(--color-surface));
  box-shadow: 0 10px 24px color-mix(in srgb, var(--petal-accent) 24%, transparent);
}

.petal:active {
  transform: scale(0.96);
}

.petal:focus-visible {
  outline: 0;
}

.petal:focus-visible .petal-icon {
  outline: 3px solid var(--color-focus);
  outline-offset: 3px;
}

.petal[data-category='health'] {
  --petal-accent: var(--color-health);
}

.petal[data-category='clipboard'] {
  --petal-accent: var(--color-clipboard);
}

.petal[data-category='dev-tools'] {
  --petal-accent: var(--color-dev-tools);
}

.petal[data-category='files'] {
  --petal-accent: var(--color-files);
}

.petal[data-category='quick-actions'] {
  --petal-accent: var(--color-quick-actions);
}
</style>
