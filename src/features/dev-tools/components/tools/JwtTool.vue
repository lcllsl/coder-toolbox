<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy, ShieldAlert, UnlockKeyhole } from '@lucide/vue'

import { useFeedbackStore } from '@/app/stores/feedback'
import { copyText } from '@/features/dev-tools/core/clipboard'
import { parseJwt, type JwtResult } from '@/features/dev-tools/core/jwt'
import ToolFrame from '../ToolFrame.vue'
import { useDevToolShortcuts } from '../useDevToolShortcuts'

const input = ref('')
const result = ref<JwtResult>()
const error = ref('')
const status = computed(() => result.value?.expired === true ? '令牌已过期' : result.value?.expired === false ? '令牌尚未过期' : result.value ? '令牌未包含 exp' : '')
const inputElement = ref<HTMLTextAreaElement>()
const feedback = useFeedbackStore()

function execute() {
  error.value = ''
  try { result.value = parseJwt(input.value) }
  catch (caught) { result.value = undefined; error.value = caught instanceof Error ? caught.message : 'JWT 解析失败' }
}
async function copyPart(part: 'header' | 'payload') {
  try { await copyText(result.value ? JSON.stringify(result.value[part], null, 2) : ''); feedback.notify(`${part === 'header' ? 'Header' : 'Payload'} 已复制`, 'success') }
  catch (caught) { error.value = caught instanceof Error ? caught.message : '复制失败' }
}
useDevToolShortcuts({ run: execute, copy: () => void copyPart('payload'), focus: () => inputElement.value?.focus() })
</script>

<template>
  <ToolFrame title="JWT 解析" description="仅在本地解析 Header 与 Payload" :error="error" :status="status">
    <div class="jwt-warning"><ShieldAlert :size="16" /><span>解析结果不代表令牌可信，不会验证签名或发送网络请求。</span></div>
    <div class="tool-pane"><label for="jwt-input">JWT</label><textarea id="jwt-input" ref="inputElement" v-model="input" class="tool-textarea jwt-input" aria-label="JWT 输入" spellcheck="false" autocomplete="off" /></div>
    <div class="tool-actions"><button class="tool-button primary" type="button" @click="execute"><UnlockKeyhole :size="14" />解析</button><button class="tool-button" type="button" @click="copyPart('header')"><Copy :size="14" />复制 Header</button><button class="tool-button" type="button" @click="copyPart('payload')"><Copy :size="14" />复制 Payload</button></div>
    <div v-if="result" class="tool-grid jwt-results">
      <div class="result-card"><strong>Header</strong><pre>{{ JSON.stringify(result.header, null, 2) }}</pre></div>
      <div class="result-card"><strong>Payload</strong><pre>{{ JSON.stringify(result.payload, null, 2) }}</pre></div>
    </div>
    <div v-if="result && Object.keys(result.claims).length" class="result-stack claim-list">
      <div v-for="(claim, name) in result.claims" :key="name" class="result-card"><strong>{{ name }}</strong><code>{{ claim?.local }} · {{ claim?.utc }}</code></div>
    </div>
  </ToolFrame>
</template>

<style scoped>
.jwt-warning { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; padding: 8px 10px; border-radius: var(--radius-sm); color: var(--color-dev-tools); background: color-mix(in srgb, var(--color-dev-tools) 9%, transparent); font-size: 11px; }
.jwt-input { min-height: 86px; }
.jwt-results { margin-top: 12px; }
.jwt-results .result-card { max-height: 150px; overflow: auto; }
.claim-list { margin-top: 8px; }
</style>
