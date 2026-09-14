<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, ShieldCheck, Trash2 } from '@lucide/vue'

import { useFeedbackStore } from '@/app/stores/feedback'
import { useSettingsStore } from '@/app/stores/settings'
import type { AiModel } from '@/features/settings/types'
import { aiErrorMessage, deleteAiApiKey, getAiStatus, saveAiApiKey, testAiConnection } from '@/services/tauri/ai'

const settings = useSettingsStore()
const feedback = useFeedbackStore()
const apiKey = ref('')
const revealKey = ref(false)
const hasApiKey = ref(false)
const busy = ref(false)
const testing = ref(false)
const connectionState = ref<'idle' | 'success' | 'error'>('idle')
const connectionMessage = ref('')
const keyPlaceholder = computed(() => hasApiKey.value ? '已保存在本机，输入新 Key 可替换' : '输入 DeepSeek API Key')

async function refreshStatus() {
  try { hasApiKey.value = (await getAiStatus()).hasApiKey }
  catch { hasApiKey.value = false }
}

async function saveKey() {
  const key = apiKey.value.trim()
  if (!key) { feedback.notify('请输入 API Key', 'warning'); return }
  busy.value = true
  try {
    await saveAiApiKey(key)
    apiKey.value = ''
    hasApiKey.value = true
    connectionState.value = 'idle'
    feedback.notify('API Key 已保存到本机应用数据', 'success')
  } catch (error) { feedback.notify(aiErrorMessage(error), 'warning') }
  finally { busy.value = false }
}

async function testConnection() {
  testing.value = true
  connectionState.value = 'idle'
  try {
    await testAiConnection(settings.settings.aiModel)
    connectionState.value = 'success'
    connectionMessage.value = '连接成功，AI 服务可以使用'
  } catch (error) {
    connectionState.value = 'error'
    connectionMessage.value = aiErrorMessage(error)
  } finally { testing.value = false }
}

async function removeKey() {
  busy.value = true
  try {
    await deleteAiApiKey()
    hasApiKey.value = false
    apiKey.value = ''
    connectionState.value = 'idle'
    feedback.notify('API Key 已从本机应用数据移除', 'success')
  } catch (error) { feedback.notify(aiErrorMessage(error), 'warning') }
  finally { busy.value = false }
}

async function changeModel(value: string) {
  await settings.setAiModel(value as AiModel)
  connectionState.value = 'idle'
}

onMounted(async () => {
  await settings.initialize()
  await refreshStatus()
})
</script>

<template>
  <section class="ai-service-settings">
    <header><h2>DeepSeek 服务</h2><p>智能图表只发送脱敏后的字段概况与少量样例，Excel 文件本身不会上传。</p></header>
    <div class="provider-card"><span><KeyRound :size="21" /></span><div><strong>DeepSeek</strong><small>{{ hasApiKey ? 'API Key 已配置' : '尚未配置 API Key' }}</small></div><em :class="{ ready: hasApiKey }">{{ hasApiKey ? '已配置' : '待配置' }}</em></div>
    <label class="field"><span>API Key</span><div class="key-input"><input v-model="apiKey" :type="revealKey ? 'text' : 'password'" :placeholder="keyPlaceholder" autocomplete="off" spellcheck="false" /><button type="button" :aria-label="revealKey ? '隐藏 API Key' : '显示 API Key'" @click="revealKey = !revealKey"><EyeOff v-if="revealKey" :size="17" /><Eye v-else :size="17" /></button></div><small>密钥保存在本机应用数据中，不写入数据库、导出报告或日志；调用 AI 时不再触发系统钥匙串授权。</small></label>
    <label class="field"><span>模型</span><select :value="settings.settings.aiModel" @change="changeModel(($event.target as HTMLSelectElement).value)"><option value="deepseek-v4-flash">DeepSeek V4 Flash（推荐）</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select><small>智能图表使用非思考模式和 JSON 输出，优先保证响应速度与结构稳定。</small></label>
    <div class="actions"><button type="button" class="primary" :disabled="busy || !apiKey.trim()" @click="saveKey"><LoaderCircle v-if="busy" class="spin" :size="16" /><KeyRound v-else :size="16" />保存 Key</button><button type="button" :disabled="testing || !hasApiKey" @click="testConnection"><LoaderCircle v-if="testing" class="spin" :size="16" /><CheckCircle2 v-else :size="16" />测试连接</button><button v-if="hasApiKey" type="button" class="danger" :disabled="busy" @click="removeKey"><Trash2 :size="16" />移除</button></div>
    <p v-if="connectionState !== 'idle'" class="connection-result" :class="connectionState" role="status">{{ connectionMessage }}</p>
    <div class="privacy-note"><ShieldCheck :size="20" /><div><strong>AI 数据处理说明</strong><p>只发送字段名、推断类型、基础统计和最多 12 行脱敏样例。疑似身份证、手机号、银行卡、邮箱、密码或 Token 的样例值会替换为 [REDACTED]。</p></div></div>
  </section>
</template>

<style scoped>
.ai-service-settings{display:grid;gap:12px}.ai-service-settings header h2{margin:0 0 3px;font-size:16px}.ai-service-settings header p,.field small,.privacy-note p{margin:0;color:var(--color-text-muted);font-size:var(--font-size-caption);line-height:1.45}.provider-card{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;padding:12px;border:1px solid color-mix(in srgb,var(--color-ai-office) 22%,var(--color-border));border-radius:var(--radius-sm);background:color-mix(in srgb,var(--color-ai-office) 6%,var(--color-surface))}.provider-card>span{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 12%,transparent)}.provider-card div{display:grid;gap:2px}.provider-card strong{font-size:14px}.provider-card small{color:var(--color-text-muted);font-size:12px}.provider-card em{padding:4px 8px;border-radius:99px;color:var(--color-text-muted);background:var(--color-surface-soft);font-size:11px;font-style:normal}.provider-card em.ready{color:#39836f;background:color-mix(in srgb,#58aa91 13%,transparent)}.field{display:grid;gap:6px}.field>span{font-size:13px;font-weight:650}.field input,.field select{width:100%;min-height:40px;padding:8px 10px;border:1px solid var(--color-border);border-radius:var(--radius-xs);color:var(--color-text);background:var(--color-surface-soft);outline:0}.key-input{display:grid;grid-template-columns:1fr 40px;gap:6px}.key-input button{display:grid;place-items:center;border:1px solid var(--color-border);border-radius:var(--radius-xs);color:var(--color-text-muted);background:var(--color-surface);cursor:pointer}.actions{display:flex;gap:7px;flex-wrap:wrap}.actions button{min-height:36px;display:flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid var(--color-border);border-radius:99px;color:var(--color-text-secondary);background:var(--color-surface);font-size:12px;cursor:pointer}.actions .primary{border-color:transparent;color:#fff;background:var(--color-ai-office)}.actions .danger{color:#c75e5e}.actions button:disabled{opacity:.48;cursor:not-allowed}.connection-result{margin:0;padding:8px 10px;border-radius:9px;font-size:12px}.connection-result.success{color:#2d7a65;background:color-mix(in srgb,#58aa91 12%,transparent)}.connection-result.error{color:#b75a55;background:color-mix(in srgb,#d16b63 10%,transparent)}.privacy-note{display:flex;align-items:flex-start;gap:9px;padding:11px;border-radius:var(--radius-sm);color:var(--color-ai-office);background:var(--color-surface-soft)}.privacy-note div{display:grid;gap:3px}.privacy-note strong{color:var(--color-text);font-size:13px}.spin{animation:spin 1s linear infinite}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--color-focus);outline-offset:2px}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spin{animation:none}}
</style>
