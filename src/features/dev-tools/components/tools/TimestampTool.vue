<script setup lang="ts">
import { computed, ref } from 'vue'
import { Clock, Copy, Play } from '@lucide/vue'

import { useFeedbackStore } from '@/app/stores/feedback'
import { copyText } from '@/features/dev-tools/core/clipboard'
import { currentTimestamp, dateTimeToTimestamp, parseTimestamp, type TimestampUnit } from '@/features/dev-tools/core/timestamp'
import ToolFrame from '../ToolFrame.vue'
import { useDevToolShortcuts } from '../useDevToolShortcuts'

const mode = ref<'timestamp-to-date' | 'date-to-timestamp'>('timestamp-to-date')
const input = ref('')
const unit = ref<TimestampUnit>('seconds')
const output = ref('')
const local = ref('')
const utc = ref('')
const error = ref('')
const status = ref('')
const inputElement = ref<HTMLInputElement>()
const feedback = useFeedbackStore()
const timezone = computed(() => Intl.DateTimeFormat().resolvedOptions().timeZone)

function execute() {
  error.value = ''; status.value = ''; local.value = ''; utc.value = ''
  try {
    if (mode.value === 'timestamp-to-date') {
      const result = parseTimestamp(input.value)
      output.value = result.local; local.value = result.local; utc.value = result.utc
      status.value = `自动识别为${result.unit === 'seconds' ? '秒级' : '毫秒级'}时间戳`
    } else {
      output.value = dateTimeToTimestamp(input.value, unit.value)
      status.value = `已转换为${unit.value === 'seconds' ? '秒级' : '毫秒级'}时间戳`
    }
  } catch (caught) { error.value = caught instanceof Error ? caught.message : '时间转换失败' }
}
function useNow() { input.value = mode.value === 'timestamp-to-date' ? currentTimestamp(unit.value) : new Date().toISOString().slice(0, 16); execute() }
async function copyResult() {
  try { await copyText(output.value); feedback.notify('时间结果已复制', 'success') }
  catch (caught) { error.value = caught instanceof Error ? caught.message : '复制失败' }
}
useDevToolShortcuts({ run: execute, copy: () => void copyResult(), focus: () => inputElement.value?.focus() })
</script>

<template>
  <ToolFrame title="时间戳转换" :description="`本地时区：${timezone}`" :error="error" :status="status">
    <template #options>
      <select v-model="mode" class="tool-select" aria-label="时间转换方向"><option value="timestamp-to-date">时间戳 → 日期</option><option value="date-to-timestamp">日期 → 时间戳</option></select>
      <select v-model="unit" class="tool-select" aria-label="时间戳单位"><option value="seconds">秒</option><option value="milliseconds">毫秒</option></select>
    </template>
    <div class="tool-pane">
      <label for="timestamp-input">{{ mode === 'timestamp-to-date' ? '10 位或 13 位时间戳' : '本地日期时间' }}</label>
      <input id="timestamp-input" ref="inputElement" v-model="input" class="tool-input" :type="mode === 'date-to-timestamp' ? 'datetime-local' : 'text'" aria-label="时间输入" />
    </div>
    <div v-if="output" class="result-stack timestamp-results">
      <div class="result-card"><strong>结果</strong><code>{{ output }}</code></div>
      <div v-if="local" class="result-card"><strong>本地时间</strong><code>{{ local }}</code></div>
      <div v-if="utc" class="result-card"><strong>UTC</strong><code>{{ utc }}</code></div>
    </div>
    <div class="tool-actions">
      <button class="tool-button primary" type="button" @click="execute"><Play :size="14" />转换</button>
      <button class="tool-button" type="button" @click="useNow"><Clock :size="14" />使用当前时间</button>
      <button class="tool-button" type="button" @click="copyResult"><Copy :size="14" />复制结果</button>
    </div>
  </ToolFrame>
</template>

<style scoped>
.timestamp-results { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 12px; }
@media (max-width: 680px) { .timestamp-results { grid-template-columns: 1fr; } }
</style>
