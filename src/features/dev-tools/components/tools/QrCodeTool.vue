<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { Copy, Download, ImageUp, QrCode } from '@lucide/vue'

import { useFeedbackStore } from '@/app/stores/feedback'
import { copyText } from '@/features/dev-tools/core/clipboard'
import { decodeQrFile, generateQrDataUrl } from '@/features/dev-tools/core/qr-code'
import ToolFrame from '../ToolFrame.vue'
import { useDevToolShortcuts } from '../useDevToolShortcuts'

const input = ref('')
const generatedImage = ref('')
const uploadedImage = ref('')
const decodedText = ref('')
const selectedFileName = ref('')
const error = ref('')
const status = ref('')
const processing = ref(false)
const inputElement = ref<HTMLTextAreaElement>()
const feedback = useFeedbackStore()

function replaceUploadedPreview(file?: File) {
  if (uploadedImage.value) URL.revokeObjectURL(uploadedImage.value)
  uploadedImage.value = file ? URL.createObjectURL(file) : ''
}

async function generate() {
  error.value = ''
  status.value = ''
  try {
    generatedImage.value = await generateQrDataUrl(input.value)
    status.value = '二维码已生成'
  } catch (caught) {
    generatedImage.value = ''
    error.value = caught instanceof Error ? caught.message : '二维码生成失败'
  }
}

async function recognize(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file) return
  error.value = ''
  status.value = ''
  decodedText.value = ''
  selectedFileName.value = file.name
  replaceUploadedPreview(file)
  processing.value = true
  try {
    decodedText.value = await decodeQrFile(file)
    status.value = '二维码识别成功'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '二维码识别失败'
  } finally {
    processing.value = false
  }
}

async function copyResult() {
  const content = decodedText.value || input.value
  if (!content) {
    error.value = '当前没有可复制的内容'
    return
  }
  try {
    await copyText(content)
    feedback.notify('二维码内容已复制', 'success')
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '复制失败'
  }
}

function downloadImage() {
  if (!generatedImage.value) return
  const anchor = document.createElement('a')
  anchor.href = generatedImage.value
  anchor.download = 'qrcode.png'
  anchor.click()
  window.setTimeout(() => feedback.notify('二维码图片已保存', 'success'), 0)
}

useDevToolShortcuts({
  run: () => void generate(),
  copy: () => void copyResult(),
  focus: () => inputElement.value?.focus(),
})

onUnmounted(() => replaceUploadedPreview())
</script>

<template>
  <ToolFrame title="二维码转换" description="文本生成与图片识别均在本机完成" :error="error" :status="status">
    <div class="qr-layout">
      <section class="qr-section" aria-labelledby="qr-generate-title">
        <div class="qr-section-title"><QrCode :size="17" /><strong id="qr-generate-title">生成二维码</strong></div>
        <label class="field-label" for="qr-content">字符串内容</label>
        <textarea id="qr-content" ref="inputElement" v-model="input" class="tool-textarea qr-input" aria-label="二维码字符串" placeholder="输入文本、网址或其他字符串" spellcheck="false" />
        <div class="tool-actions">
          <button class="tool-button primary" type="button" @click="generate"><QrCode :size="14" />转换</button>
          <button v-if="generatedImage" class="tool-button" type="button" @click="downloadImage"><Download :size="14" />保存图片</button>
        </div>
        <div v-if="generatedImage" class="qr-image-card">
          <img :src="generatedImage" alt="生成的二维码" />
        </div>
      </section>

      <section class="qr-section" aria-labelledby="qr-recognize-title">
        <div class="qr-section-title"><ImageUp :size="17" /><strong id="qr-recognize-title">识别二维码</strong></div>
        <label class="qr-upload" :class="{ processing }">
          <ImageUp :size="23" />
          <strong>{{ processing ? '正在识别…' : '上传二维码图片' }}</strong>
          <span>{{ selectedFileName || '支持常见图片格式，最大 15 MB' }}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" aria-label="上传二维码图片" :disabled="processing" @change="recognize" />
        </label>
        <div v-if="uploadedImage" class="qr-uploaded-preview"><img :src="uploadedImage" alt="待识别的二维码图片" /></div>
        <div v-if="decodedText" class="qr-result">
          <label class="field-label" for="qr-result">识别结果</label>
          <textarea id="qr-result" :value="decodedText" class="tool-textarea output" aria-label="二维码识别结果" readonly />
          <button class="tool-button" type="button" @click="copyResult"><Copy :size="14" />复制结果</button>
        </div>
      </section>
    </div>
  </ToolFrame>
</template>

<style scoped>
.qr-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.qr-section { min-width: 0; padding: 12px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-soft); }
.qr-section-title { display: flex; align-items: center; gap: 7px; margin-bottom: 11px; color: var(--color-dev-tools); }
.qr-section-title strong { font-size: 14px; }
.qr-input { min-height: 92px; margin-top: 7px; }
.qr-image-card { display: grid; place-items: center; margin-top: 11px; padding: 10px; border-radius: var(--radius-sm); background: #fff; }
.qr-image-card img { width: min(100%, 210px); aspect-ratio: 1; display: block; }
.qr-upload { min-height: 128px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 14px; border: 1px dashed var(--color-border); border-radius: var(--radius-sm); color: var(--color-text-secondary); background: var(--color-surface); cursor: pointer; text-align: center; transition: border-color var(--duration-fast), background var(--duration-fast); }
.qr-upload:hover { border-color: var(--color-dev-tools); background: color-mix(in srgb, var(--color-dev-tools) 5%, var(--color-surface)); }
.qr-upload:focus-within { outline: 2px solid var(--color-focus); outline-offset: 2px; }
.qr-upload.processing { cursor: wait; opacity: 0.75; }
.qr-upload span { color: var(--color-text-muted); font-size: 12px; overflow-wrap: anywhere; }
.qr-upload input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.qr-uploaded-preview { display: grid; place-items: center; height: 82px; margin-top: 9px; padding: 6px; border-radius: var(--radius-sm); background: #fff; overflow: hidden; }
.qr-uploaded-preview img { max-width: 100%; max-height: 70px; object-fit: contain; }
.qr-result { display: grid; gap: 7px; margin-top: 9px; }
.qr-result .tool-textarea { min-height: 68px; max-height: 110px; }
.qr-result .tool-button { justify-self: start; }
@media (max-width: 680px) { .qr-layout { grid-template-columns: 1fr; } }
</style>
