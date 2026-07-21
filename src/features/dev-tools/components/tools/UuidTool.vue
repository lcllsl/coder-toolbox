<script setup lang="ts">
import { ref } from 'vue'
import { Copy, RefreshCw } from '@lucide/vue'

import { useFeedbackStore } from '@/app/stores/feedback'
import { copyText } from '@/features/dev-tools/core/clipboard'
import { generateUuids, type UuidCount } from '@/features/dev-tools/core/uuid'
import ToolFrame from '../ToolFrame.vue'
import { useDevToolShortcuts } from '../useDevToolShortcuts'

const count = ref<UuidCount>(5)
const uppercase = ref(false)
const compact = ref(false)
const values = ref<string[]>([])
const error = ref('')
const feedback = useFeedbackStore()

function execute() { error.value = ''; values.value = generateUuids({ count: count.value, uppercase: uppercase.value, compact: compact.value }) }
async function copyAll() {
  try { await copyText(values.value.join('\n')); feedback.notify(`${values.value.length} 个 UUID 已复制`, 'success') }
  catch (caught) { error.value = caught instanceof Error ? caught.message : '复制失败' }
}
async function copyOne(value: string) { try { await copyText(value); feedback.notify('UUID 已复制', 'success') } catch { error.value = '复制失败' } }
useDevToolShortcuts({ run: execute, copy: () => void copyAll(), focus: () => undefined })
execute()
</script>

<template>
  <ToolFrame title="UUID 生成" description="生成符合 RFC 4122 的 UUID v4" :error="error">
    <template #options>
      <select v-model="count" class="tool-select" aria-label="UUID 数量"><option :value="1">1 个</option><option :value="5">5 个</option><option :value="10">10 个</option><option :value="20">20 个</option></select>
      <label class="tool-toggle"><input v-model="compact" type="checkbox" />去连字符</label>
      <label class="tool-toggle"><input v-model="uppercase" type="checkbox" />大写</label>
    </template>
    <div class="uuid-list" aria-label="UUID 结果">
      <button v-for="value in values" :key="value" type="button" title="点击复制" @click="copyOne(value)"><code>{{ value }}</code><Copy :size="13" /></button>
    </div>
    <div class="tool-actions"><button class="tool-button primary" type="button" @click="execute"><RefreshCw :size="14" />重新生成</button><button class="tool-button" type="button" @click="copyAll"><Copy :size="14" />复制全部</button></div>
  </ToolFrame>
</template>

<style scoped>
.uuid-list { max-height: 258px; display: grid; gap: 6px; overflow: auto; }
.uuid-list button { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 11px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); color: var(--color-text); background: var(--color-surface-soft); cursor: pointer; }
.uuid-list code { overflow: hidden; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; text-overflow: ellipsis; user-select: text; }
</style>
