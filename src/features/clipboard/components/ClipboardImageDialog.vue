<script setup lang="ts">
import { Image as ImageIcon, X } from '@lucide/vue'

import type { ClipboardItem } from '../types'
import ClipboardImagePreview from './ClipboardImagePreview.vue'

defineProps<{ item: ClipboardItem | undefined }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <Transition name="image-dialog">
      <div v-if="item?.imagePath" class="image-dialog-backdrop" @click.self="emit('close')" @keydown.esc.stop.prevent="emit('close')">
        <section class="image-dialog" role="dialog" aria-modal="true" aria-label="图片预览">
          <header>
            <span><ImageIcon :size="17" />图片预览 <small>{{ item.previewText }}</small></span>
            <button type="button" aria-label="关闭图片预览" autofocus @click="emit('close')"><X :size="18" /></button>
          </header>
          <ClipboardImagePreview :path="item.imagePath" :alt="`剪贴板图片预览，${item.previewText}`" mode="dialog" />
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.image-dialog-backdrop { position: fixed; z-index: 45; inset: 0; display: grid; place-items: center; padding: 34px; background: rgb(10 14 22 / 42%); backdrop-filter: blur(7px); }
.image-dialog { width: min(580px, 100%); height: min(560px, calc(100vh - 68px)); display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 10px; padding: 12px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-panel); }
.image-dialog header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-left: 3px; }
.image-dialog header > span { display: flex; align-items: center; gap: 7px; font-size: var(--font-size-body); font-weight: 650; }
.image-dialog header small { color: var(--color-text-muted); font-size: var(--font-size-caption); font-weight: 400; }
.image-dialog header button { width: 34px; height: 34px; display: grid; place-items: center; border: 0; border-radius: 50%; color: var(--color-text-secondary); background: transparent; cursor: pointer; }
.image-dialog header button:hover { color: var(--color-text); background: var(--color-surface-hover); }
.image-dialog header button:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
.image-dialog-enter-active, .image-dialog-leave-active { transition: opacity var(--duration-normal); }
.image-dialog-enter-active .image-dialog, .image-dialog-leave-active .image-dialog { transition: transform var(--duration-normal); }
.image-dialog-enter-from, .image-dialog-leave-to { opacity: 0; }
.image-dialog-enter-from .image-dialog, .image-dialog-leave-to .image-dialog { transform: scale(.96) translateY(7px); }
@media (prefers-reduced-motion: reduce) { .image-dialog-enter-active, .image-dialog-leave-active, .image-dialog-enter-active .image-dialog, .image-dialog-leave-active .image-dialog { transition-duration: 20ms; } }
</style>
