<script setup lang="ts">
import { ArrowLeft, Settings, Star, X } from '@lucide/vue'

import UiTooltip from '@/components/ui/UiTooltip.vue'

defineProps<{
  title: string
  accent?: string
  favorite?: boolean
  showFavorite?: boolean
  showSettings?: boolean
}>()

const emit = defineEmits<{
  back: []
  close: []
  settings: []
  favorite: []
}>()
</script>

<template>
  <section class="panel-shell" :style="{ '--panel-accent': accent }" :aria-label="title">
    <header class="panel-header" data-tauri-drag-region>
      <div class="panel-heading">
        <UiTooltip text="返回分类">
          <button class="icon-button" type="button" aria-label="返回分类" @click="emit('back')">
            <ArrowLeft :size="19" aria-hidden="true" />
          </button>
        </UiTooltip>
        <span class="category-mark" aria-hidden="true"><slot name="icon" /></span>
        <div>
          <p class="eyebrow">冒泡</p>
          <h1>{{ title }}</h1>
        </div>
      </div>
      <div class="panel-actions">
        <UiTooltip v-if="showFavorite" :text="favorite ? '取消收藏' : '收藏分类'">
          <button
            class="icon-button"
            :class="{ active: favorite }"
            type="button"
            :aria-label="favorite ? '取消收藏' : '收藏分类'"
            :aria-pressed="favorite"
            @click="emit('favorite')"
          >
            <Star :size="18" :fill="favorite ? 'currentColor' : 'none'" aria-hidden="true" />
          </button>
        </UiTooltip>
        <UiTooltip v-if="showSettings !== false" text="打开设置">
          <button class="icon-button" type="button" aria-label="打开设置" @click="emit('settings')">
            <Settings :size="18" aria-hidden="true" />
          </button>
        </UiTooltip>
        <UiTooltip text="关闭面板">
          <button class="icon-button" type="button" aria-label="关闭面板" @click="emit('close')">
            <X :size="19" aria-hidden="true" />
          </button>
        </UiTooltip>
      </div>
    </header>
    <main class="panel-content">
      <slot />
    </main>
  </section>
</template>

<style scoped>
.panel-shell {
  --panel-accent: var(--color-orb-end);
  width: 100%;
  height: 100%;
  min-height: 100%;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: color-mix(in srgb, var(--color-surface) 94%, transparent);
  box-shadow: var(--shadow-panel);
  backdrop-filter: blur(22px) saturate(1.18);
  animation: panel-arrive 360ms var(--ease-standard) both;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 76px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.panel-heading,
.panel-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.category-mark {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  color: var(--panel-accent);
  background: color-mix(in srgb, var(--panel-accent) 12%, transparent);
}

.eyebrow {
  margin: 0 0 2px;
  color: var(--color-text-muted);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
}

.icon-button {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-pill);
  color: var(--color-text-secondary);
  background: transparent;
  cursor: pointer;
}

.icon-button:hover {
  color: var(--color-text);
  background: var(--color-surface-hover);
}

.icon-button.active { color: var(--panel-accent); }

.icon-button:active {
  transform: scale(0.92);
}

.icon-button:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.panel-content {
  max-height: calc(100vh - 98px);
  overflow: auto;
  padding: 24px;
}

@keyframes panel-arrive {
  from { opacity: 0; transform: translateY(10px) scale(0.975); }
}
</style>
