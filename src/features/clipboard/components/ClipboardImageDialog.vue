<script setup lang="ts">
import { Image as ImageIcon, X } from '@lucide/vue'

import type { ClipboardItem } from '../types'
import ClipboardImagePreview from './ClipboardImagePreview.vue'

defineProps<{ item: ClipboardItem | undefined }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <Transition name="ui-modal" :duration="{ enter: 220, leave: 160 }">
      <div v-if="item?.imagePath" class="image-dialog-backdrop ui-modal-backdrop" @click.self="emit('close')" @keydown.esc.stop.prevent="emit('close')">
        <section class="image-dialog ui-modal-surface" role="dialog" aria-modal="true" aria-label="图片预览">
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
.image-dialog-backdrop { padding: 34px; }
.image-dialog { width: min(580px, 100%); height: min(560px, calc(100vh - 68px)); display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 10px; padding: 12px; }
.image-dialog header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-left: 3px; }
.image-dialog header > span { display: flex; align-items: center; gap: 7px; font-size: var(--font-size-body); font-weight: 650; }
.image-dialog header small { color: var(--color-text-muted); font-size: var(--font-size-caption); font-weight: 400; }
.image-dialog header button { width: 34px; height: 34px; display: grid; place-items: center; border: 0; border-radius: 50%; color: var(--color-text-secondary); background: transparent; cursor: pointer; }
.image-dialog header button:hover { color: var(--color-text); background: var(--color-surface-hover); }
.image-dialog header button:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
</style>
