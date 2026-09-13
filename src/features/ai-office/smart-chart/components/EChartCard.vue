<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { ArrowDown, ArrowUp, Trash2 } from '@lucide/vue'

import type { ChartType, ProcessedChart } from '../types'
import { buildEChartOption } from '../report/echartsBuilder'

const props = defineProps<{ chart: ProcessedChart; first: boolean; last: boolean }>()
const emit = defineEmits<{ title: [value: string]; type: [value: ChartType]; delete: []; move: [direction: -1 | 1] }>()
const element = ref<HTMLDivElement>()
let instance: echarts.ECharts | undefined
let observer: ResizeObserver | undefined
const option = computed(() => buildEChartOption(props.chart))

function render() {
  if (!element.value) return
  instance ??= echarts.init(element.value)
  instance.setOption(option.value, true)
}

onMounted(() => {
  render()
  observer = new ResizeObserver(() => instance?.resize())
  if (element.value) observer.observe(element.value)
})
watch(option, () => void nextTick(render), { deep: true })
onBeforeUnmount(() => { observer?.disconnect(); instance?.dispose() })
</script>

<template>
  <article class="chart-card">
    <header>
      <input :value="chart.spec.title" aria-label="图表标题" @change="emit('title', ($event.target as HTMLInputElement).value)" />
      <div class="chart-actions"><select :value="chart.spec.type" aria-label="图表类型" @change="emit('type', ($event.target as HTMLSelectElement).value as ChartType)"><option value="bar">柱状图</option><option value="horizontal-bar">横向柱状图</option><option value="line">折线图</option><option value="area">面积图</option><option value="pie">饼图</option><option value="donut">环形图</option><option value="scatter">散点图</option></select><button type="button" :disabled="first" aria-label="上移图表" @click="emit('move', -1)"><ArrowUp :size="15" /></button><button type="button" :disabled="last" aria-label="下移图表" @click="emit('move', 1)"><ArrowDown :size="15" /></button><button type="button" class="delete" aria-label="删除图表" @click="emit('delete')"><Trash2 :size="15" /></button></div>
    </header>
    <p>{{ chart.spec.description }}</p>
    <div ref="element" class="chart-canvas" role="img" :aria-label="chart.spec.title" />
  </article>
</template>

<style scoped>
.chart-card{min-width:0;padding:14px;border:1px solid var(--color-border-subtle);border-radius:16px;background:var(--color-surface);box-shadow:var(--shadow-sm)}header{display:flex;align-items:center;justify-content:space-between;gap:8px}header>input{min-width:0;flex:1;padding:5px 6px;border:1px solid transparent;border-radius:7px;color:var(--color-text);background:transparent;font-size:15px;font-weight:650;outline:0}header>input:hover,header>input:focus{border-color:var(--color-border);background:var(--color-surface-soft)}.chart-actions{display:flex;gap:4px}.chart-actions select,.chart-actions button{height:30px;border:1px solid var(--color-border);border-radius:8px;color:var(--color-text-secondary);background:var(--color-surface-soft);font-size:11px}.chart-actions select{max-width:92px;padding:0 6px}.chart-actions button{width:30px;display:grid;place-items:center;cursor:pointer}.chart-actions button:disabled{opacity:.3;cursor:not-allowed}.chart-actions .delete{color:#be6262}p{min-height:18px;margin:4px 6px 0;color:var(--color-text-muted);font-size:12px;line-height:1.4}.chart-canvas{height:300px;margin-top:2px}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--color-focus);outline-offset:1px}@media(max-width:760px){header{align-items:flex-start;flex-direction:column}.chart-actions{width:100%}.chart-actions select{margin-right:auto}.chart-canvas{height:280px}}
</style>
