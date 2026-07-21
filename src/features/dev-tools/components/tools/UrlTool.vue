<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeftRight, Copy, Play } from '@lucide/vue'

import { useFeedbackStore } from '@/app/stores/feedback'
import { copyText } from '@/features/dev-tools/core/clipboard'
import { detectUrlEncoding, transformUrl, type UrlOperation } from '@/features/dev-tools/core/url'
import ToolFrame from '../ToolFrame.vue'
import { useDevToolShortcuts } from '../useDevToolShortcuts'

const input = ref('')
const output = ref('')
const operation = ref<UrlOperation>('encode-component')
const error = ref('')
const status = ref('')
const inputElement = ref<HTMLTextAreaElement>()
const feedback = useFeedbackStore()
const detection = computed(() => input.value ? `检测：${detectUrlEncoding(input.value) === 'encoded' ? '可能已编码' : '普通文本'}` : '')

function execute() {
  error.value = ''; status.value = ''
  try { output.value = transformUrl(input.value, operation.value); status.value = 'URL 处理完成' }
  catch (caught) { error.value = caught instanceof Error ? caught.message : 'URL 处理失败' }
}
async function copyResult() {
  try { await copyText(output.value); feedback.notify('URL 结果已复制', 'success') }
  catch (caught) { error.value = caught instanceof Error ? caught.message : '复制失败' }
}
function swap() { if (output.value) [input.value, output.value] = [output.value, input.value] }
useDevToolShortcuts({ run: execute, copy: () => void copyResult(), focus: () => inputElement.value?.focus() })
</script>

<template>
  <ToolFrame title="URL 编解码" description="支持 URI、组件与查询参数转换" :error="error" :status="status || detection">
    <template #options>
      <select v-model="operation" class="tool-select" aria-label="URL 操作">
        <option value="encode-component">编码组件</option><option value="encode-uri">编码完整 URI</option><option value="decode">解码</option><option value="query-to-json">查询参数 → JSON</option><option value="json-to-query">JSON → 查询参数</option>
      </select>
    </template>
    <div class="tool-grid">
      <div class="tool-pane"><label for="url-input">输入</label><textarea id="url-input" ref="inputElement" v-model="input" class="tool-textarea" aria-label="URL 输入" spellcheck="false" placeholder="输入网址、文本或查询参数…" /></div>
      <div class="tool-pane"><label for="url-output">结果</label><textarea id="url-output" v-model="output" class="tool-textarea output" aria-label="URL 结果" readonly /></div>
    </div>
    <div class="tool-actions">
      <button class="tool-button primary" type="button" @click="execute"><Play :size="14" />执行</button>
      <button class="tool-button" type="button" @click="swap"><ArrowLeftRight :size="14" />交换</button>
      <button class="tool-button" type="button" @click="copyResult"><Copy :size="14" />复制结果</button>
    </div>
  </ToolFrame>
</template>
