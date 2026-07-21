<script setup lang="ts">
import { ImageOff } from '@lucide/vue'
import { onBeforeUnmount, ref, watch } from 'vue'

import { loadClipboardImageUrl } from '@/services/tauri/clipboard'

const props = withDefaults(defineProps<{ path: string; alt: string; mode?: 'card' | 'dialog' }>(), { mode: 'card' })
const url = ref('')
const failed = ref(false)

function releaseUrl() {
  if (url.value.startsWith('blob:')) URL.revokeObjectURL(url.value)
  url.value = ''
}

watch(() => props.path, async (path) => {
  releaseUrl()
  failed.value = false
  try { url.value = await loadClipboardImageUrl(path) }
  catch { failed.value = true }
}, { immediate: true })

onBeforeUnmount(releaseUrl)
</script>

<template>
  <div class="image-preview" :class="`mode-${mode}`">
    <img v-if="url && !failed" :src="url" :alt="alt" @error="failed = true" />
    <span v-else><ImageOff :size="22" />图片缓存不可用</span>
  </div>
</template>

<style scoped>
.image-preview { height: 92px; margin-top: 8px; overflow: hidden; border-radius: var(--radius-sm); background: color-mix(in srgb, var(--color-clipboard) 6%, var(--color-surface)); }
.image-preview img { width: 100%; height: 100%; display: block; object-fit: contain; }
.image-preview span { height: 100%; display: grid; place-items: center; align-content: center; gap: 4px; color: var(--color-text-muted); font-size: var(--font-size-caption); }
.image-preview.mode-dialog { width: 100%; height: 100%; min-height: 240px; margin: 0; background: color-mix(in srgb, var(--color-surface-soft) 78%, transparent); }
</style>
