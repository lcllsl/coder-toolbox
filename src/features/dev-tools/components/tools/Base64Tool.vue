<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy, FileImage, Play } from '@lucide/vue'

import { useFeedbackStore } from '@/app/stores/feedback'
import { decodeBase64Utf8, encodeBase64Utf8, stripDataUrl, toDataUrl } from '@/features/dev-tools/core/base64'
import { copyText } from '@/features/dev-tools/core/clipboard'
import ToolFrame from '../ToolFrame.vue'
import { useDevToolShortcuts } from '../useDevToolShortcuts'

type Operation = 'encode' | 'decode' | 'to-data-url' | 'strip-data-url'
const input = ref('')
const output = ref('')
const operation = ref<Operation>('encode')
const error = ref('')
const status = ref('')
const imageWarning = ref('')
const inputElement = ref<HTMLTextAreaElement>()
const feedback = useFeedbackStore()
const preview = computed(() => output.value.startsWith('data:image/') ? output.value : input.value.startsWith('data:image/') ? input.value : '')

function execute() {
  error.value = ''; status.value = ''
  try {
    output.value = operation.value === 'encode' ? encodeBase64Utf8(input.value) : operation.value === 'decode' ? decodeBase64Utf8(input.value) : operation.value === 'to-data-url' ? toDataUrl(input.value) : stripDataUrl(input.value)
    status.value = 'Base64 处理完成'
  } catch (caught) { error.value = caught instanceof Error ? caught.message : 'Base64 处理失败' }
}
async function copyResult() {
  try { await copyText(output.value); feedback.notify('Base64 结果已复制', 'success') }
  catch (caught) { error.value = caught instanceof Error ? caught.message : '复制失败' }
}
function loadImage(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  imageWarning.value = file.size > 5 * 1024 * 1024 ? '图片超过 5 MB，转换可能需要一些时间' : ''
  const reader = new FileReader()
  reader.onload = () => { input.value = String(reader.result); output.value = input.value; status.value = '图片已转换为 Data URL' }
  reader.onerror = () => { error.value = '图片读取失败' }
  reader.readAsDataURL(file)
}
useDevToolShortcuts({ run: execute, copy: () => void copyResult(), focus: () => inputElement.value?.focus() })
</script>

<template>
  <ToolFrame title="Base64" description="UTF-8 文本、Data URL 与图片转换" :error="error || imageWarning" :status="status">
    <template #options><select v-model="operation" class="tool-select" aria-label="Base64 操作"><option value="encode">文本编码</option><option value="decode">文本解码</option><option value="to-data-url">转 Data URL</option><option value="strip-data-url">提取纯 Base64</option></select></template>
    <div class="tool-grid">
      <div class="tool-pane"><label for="base64-input">输入</label><textarea id="base64-input" ref="inputElement" v-model="input" class="tool-textarea" aria-label="Base64 输入" spellcheck="false" /></div>
      <div class="tool-pane"><label for="base64-output">结果</label><textarea id="base64-output" v-model="output" class="tool-textarea output" aria-label="Base64 结果" readonly /></div>
    </div>
    <img v-if="preview" :src="preview" class="base64-preview" alt="Base64 图片预览" />
    <div class="tool-actions">
      <button class="tool-button primary" type="button" @click="execute"><Play :size="14" />执行</button>
      <label class="tool-button"><FileImage :size="14" />选择图片<input class="visually-hidden" type="file" accept="image/*" @change="loadImage" /></label>
      <button class="tool-button" type="button" @click="copyResult"><Copy :size="14" />复制结果</button>
    </div>
  </ToolFrame>
</template>

<style scoped>
.base64-preview { display: block; max-width: 100%; max-height: 120px; margin: 10px auto 0; border-radius: var(--radius-sm); object-fit: contain; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; }
</style>
