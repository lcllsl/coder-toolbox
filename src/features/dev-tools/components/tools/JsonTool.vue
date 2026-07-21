<script setup lang="ts">
import { ref } from 'vue'
import { ArrowLeftRight, Check, ClipboardPaste, Copy, Eraser, Minimize2, WandSparkles } from '@lucide/vue'

import { useFeedbackStore } from '@/app/stores/feedback'
import { copyText, readClipboardText } from '@/features/dev-tools/core/clipboard'
import type { JsonIndent } from '@/features/dev-tools/core/json'
import { LARGE_JSON_THRESHOLD, processJson } from '@/features/dev-tools/core/json-processing'
import ToolFrame from '../ToolFrame.vue'
import { useDevToolShortcuts } from '../useDevToolShortcuts'

const input = ref('')
const output = ref('')
const indent = ref<JsonIndent>(2)
const error = ref('')
const status = ref('')
const inputElement = ref<HTMLTextAreaElement>()
const processing = ref(false)
const feedback = useFeedbackStore()

async function execute(mode: 'format' | 'minify' | 'validate' = 'format') {
  error.value = ''
  status.value = ''
  processing.value = true
  try {
    if (new Blob([input.value]).size > LARGE_JSON_THRESHOLD) status.value = '大文本正在后台处理…'
    const result = await processJson(input.value, mode, indent.value)
    output.value = result.value
    status.value = result.message
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'JSON 处理失败'
  } finally {
    processing.value = false
  }
}

async function copyResult() {
  try { await copyText(output.value); feedback.notify('JSON 结果已复制', 'success') }
  catch (caught) { error.value = caught instanceof Error ? caught.message : '复制失败' }
}
async function pasteInput() {
  try { input.value = await readClipboardText(); await execute('format') }
  catch { error.value = '无法读取剪贴板，请检查系统权限' }
}
function swap() { if (output.value) { input.value = output.value; output.value = ''; status.value = '输入与输出已交换' } }
function clear() { input.value = ''; output.value = ''; error.value = ''; status.value = '' }

useDevToolShortcuts({ run: () => execute('format'), copy: () => void copyResult(), focus: () => inputElement.value?.focus() })
</script>

<template>
  <ToolFrame title="JSON 工具" description="格式化、压缩并校验 JSON" :error="error" :status="status">
    <template #options>
      <select v-model="indent" class="tool-select" aria-label="JSON 缩进">
        <option :value="2">2 空格</option><option :value="4">4 空格</option>
      </select>
    </template>
    <div class="tool-grid">
      <div class="tool-pane">
        <label for="json-input">输入</label>
        <textarea id="json-input" ref="inputElement" v-model="input" class="tool-textarea" aria-label="JSON 输入" spellcheck="false" placeholder="粘贴 JSON 内容…" />
      </div>
      <div class="tool-pane">
        <label for="json-output">结果</label>
        <textarea id="json-output" v-model="output" class="tool-textarea output" aria-label="JSON 结果" readonly placeholder="处理结果将在这里显示" />
      </div>
    </div>
    <div class="tool-actions">
      <button class="tool-button primary" type="button" :disabled="processing" @click="execute('format')"><WandSparkles :size="14" />格式化</button>
      <button class="tool-button" type="button" :disabled="processing" @click="execute('minify')"><Minimize2 :size="14" />压缩</button>
      <button class="tool-button" type="button" :disabled="processing" @click="execute('validate')"><Check :size="14" />校验</button>
      <button class="tool-button" type="button" @click="pasteInput"><ClipboardPaste :size="14" />从剪贴板</button>
      <button class="tool-button" type="button" @click="swap"><ArrowLeftRight :size="14" />交换</button>
      <button class="tool-button" type="button" @click="copyResult"><Copy :size="14" />复制结果</button>
      <button class="tool-button" type="button" @click="clear"><Eraser :size="14" />清空</button>
    </div>
  </ToolFrame>
</template>
