<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { BarChart3, X } from '@lucide/vue'

const props = defineProps<{
  open: boolean
  mode: 'save' | 'rename'
  initialValue: string
  busy: boolean
}>()
const emit = defineEmits<{ cancel: []; confirm: [name: string] }>()
const name = ref('')
const error = ref('')
const input = ref<HTMLInputElement>()

watch(() => props.open, async (open) => {
  if (!open) return
  name.value = props.initialValue
  error.value = ''
  await nextTick()
  input.value?.focus()
  input.value?.select()
})

function submit() {
  const value = name.value.trim()
  if (!value) { error.value = '请输入图表名称'; return }
  if (value.length > 80) { error.value = '图表名称最多 80 个字符'; return }
  emit('confirm', value)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ui-modal" :duration="{ enter: 220, leave: 160 }">
      <div v-if="open" class="name-backdrop ui-modal-backdrop" @click.self="!busy && emit('cancel')" @keydown.esc="!busy && emit('cancel')">
        <form class="name-dialog ui-modal-surface" role="dialog" aria-modal="true" aria-labelledby="chart-name-title" @submit.prevent="submit">
        <header><span><BarChart3 :size="21" /></span><div><h2 id="chart-name-title">{{ mode === 'save' ? '命名并保存图表' : '重命名图表' }}</h2><p>{{ mode === 'save' ? '名称将显示在已保存图表列表中。' : '只修改列表名称，不影响报告内容。' }}</p></div><button type="button" aria-label="关闭" :disabled="busy" @click="emit('cancel')"><X :size="18" /></button></header>
        <label for="saved-chart-name">图表名称</label>
        <input id="saved-chart-name" ref="input" v-model="name" maxlength="80" autocomplete="off" placeholder="例如：2026 年销售趋势" @input="error = ''" />
        <p v-if="error" class="name-error" role="alert">{{ error }}</p>
        <footer><button type="button" :disabled="busy" @click="emit('cancel')">取消</button><button type="submit" class="primary" :disabled="busy">{{ busy ? '正在保存…' : mode === 'save' ? '保存图表' : '确认修改' }}</button></footer>
        </form>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.name-backdrop{padding:24px}.name-dialog{width:min(430px,100%);display:grid;gap:10px;padding:18px}.name-dialog header{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;margin-bottom:5px}.name-dialog header>span{width:42px;height:42px;display:grid;place-items:center;border-radius:14px;color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 12%,transparent)}h2,p{margin:0}h2{font-size:17px}header p{margin-top:3px;color:var(--color-text-muted);font-size:12px}header button{width:34px;height:34px;display:grid;place-items:center;border:0;border-radius:50%;color:var(--color-text-muted);background:transparent;cursor:pointer}.name-dialog>label{font-size:12px;font-weight:650}.name-dialog>input{min-height:42px;padding:8px 11px;border:1px solid var(--color-border);border-radius:10px;color:var(--color-text);background:var(--color-surface-soft);font-size:14px;outline:0}.name-dialog>input:focus{border-color:var(--color-ai-office);box-shadow:0 0 0 3px color-mix(in srgb,var(--color-ai-office) 12%,transparent)}.name-error{color:#b75a55;font-size:12px}footer{display:flex;justify-content:flex-end;gap:8px;margin-top:5px}footer button{min-height:36px;padding:6px 14px;border:1px solid var(--color-border);border-radius:99px;color:var(--color-text-secondary);background:var(--color-surface);font-size:12px;cursor:pointer}footer .primary{border-color:transparent;color:#fff;background:var(--color-ai-office)}button:disabled{opacity:.5;cursor:not-allowed}button:focus-visible,input:focus-visible{outline:2px solid var(--color-focus);outline-offset:2px}
</style>
