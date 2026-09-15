<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { ChartSpline, ChevronRight, FileText, FolderTree, ShieldCheck, Sparkles, TableProperties } from '@lucide/vue'

import type { TabularDataset } from '../smart-chart/types'

const activeTool = ref<'home' | 'smart-chart' | 'smart-table' | 'smart-files'>('home')
const chartDataset = ref<TabularDataset>()
const SmartChartStudio = defineAsyncComponent(() => import('../smart-chart/components/SmartChartStudio.vue'))
const SmartTableStudio = defineAsyncComponent(() => import('../smart-table/components/SmartTableStudio.vue'))
const SmartFileOrganizer = defineAsyncComponent(() => import('../smart-file-organizer/components/SmartFileOrganizer.vue'))

function openSmartChart(dataset?: TabularDataset) {
  chartDataset.value = dataset
  activeTool.value = 'smart-chart'
}

function returnHome() {
  chartDataset.value = undefined
  activeTool.value = 'home'
}
</script>

<template>
  <div class="ai-office-root">
    <SmartChartStudio v-if="activeTool === 'smart-chart'" :initial-dataset="chartDataset" @back="returnHome" />
    <SmartTableStudio v-else-if="activeTool === 'smart-table'" @back="returnHome" @chart="openSmartChart" />
    <SmartFileOrganizer v-else-if="activeTool === 'smart-files'" @back="returnHome" />
    <section v-else class="ai-office-panel">
      <header class="ai-intro"><span class="ai-orbit" aria-hidden="true"><Sparkles :size="26" /></span><div><span class="status-pill">AI 办公</span><h2>从杂乱信息到结构化数据与图表</h2><p>整理文字、解析表格，并生成可编辑、可导出、可继续分析的数据结果。</p></div></header>
      <div class="feature-grid">
        <button class="hero-card" type="button" @click="activeTool = 'smart-table'"><span class="feature-icon"><TableProperties :size="28" /></span><span class="feature-copy"><span class="feature-heading"><strong>智能表格</strong><em>已上线</em></span><span>把聊天记录、名单、事项或其他文字整理成可编辑表格。</span><small><ShieldCheck :size="13" /> 默认隐私保护，两阶段识别，不持久化原始文本</small></span><ChevronRight class="chart-mark" :size="25" aria-hidden="true" /></button>
        <button class="hero-card" type="button" @click="openSmartChart()"><span class="feature-icon"><ChartSpline :size="28" /></span><span class="feature-copy"><span class="feature-heading"><strong>Excel 智能图表</strong><em>已上线</em></span><span>导入 XLSX、XLS 或 CSV，生成 KPI 与可交互图表。</span><small><ShieldCheck :size="13" /> 文件不上传，敏感样例默认脱敏</small></span><ChevronRight class="chart-mark" :size="25" aria-hidden="true" /></button>
        <button class="hero-card" type="button" @click="activeTool = 'smart-files'"><span class="feature-icon"><FolderTree :size="28" /></span><span class="feature-copy"><span class="feature-heading"><strong>智能文件整理</strong><em>已上线</em></span><span>扫描文件信息，自动规划目录并整理归档。</span><small><ShieldCheck :size="13" /> 不读正文、不覆盖，可撤销当前任务</small></span><ChevronRight class="chart-mark" :size="25" aria-hidden="true" /></button>
      </div>
      <div class="future-grid"><article><span><FileText :size="21" /></span><div><strong>文档助手</strong><small>规划中</small></div></article></div>
    </section>
  </div>
</template>

<style scoped>
.ai-office-root{min-height:100%}.ai-office-panel{position:relative;display:grid;gap:16px;color:var(--color-text)}.ai-office-panel::before{content:'';position:absolute;z-index:-1;inset:-30px -20px auto 35%;height:220px;background:radial-gradient(circle,color-mix(in srgb,var(--color-ai-office) 14%,transparent),transparent 68%);filter:blur(14px);animation:glow-drift 9s ease-in-out infinite alternate}.ai-intro{display:grid;grid-template-columns:64px minmax(0,1fr);align-items:center;gap:16px;padding:18px;border:1px solid color-mix(in srgb,var(--color-ai-office) 18%,var(--color-border));border-radius:var(--radius-lg);background:linear-gradient(135deg,color-mix(in srgb,var(--color-ai-office) 9%,var(--color-surface)),var(--color-surface))}.ai-orbit{width:58px;height:58px;display:grid;place-items:center;border-radius:20px;color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 13%,var(--color-surface));box-shadow:inset 0 1px 0 rgb(255 255 255/50%)}.status-pill{display:inline-flex;padding:4px 8px;border-radius:var(--radius-pill);color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 10%,transparent);font-size:12px}h2{margin:8px 0 5px;font-size:21px;line-height:1.3}p{margin:0;color:var(--color-text-secondary);font-size:14px;line-height:1.55}.feature-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.hero-card{width:100%;min-height:175px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:14px;padding:18px;border:1px solid color-mix(in srgb,var(--color-ai-office) 24%,var(--color-border));border-radius:var(--radius-lg);color:inherit;text-align:left;background:color-mix(in srgb,var(--color-ai-office) 5%,var(--color-surface));box-shadow:var(--shadow-sm);cursor:pointer;transition:transform var(--duration-fast),border-color var(--duration-fast),box-shadow var(--duration-fast)}.hero-card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--color-ai-office) 48%,var(--color-border));box-shadow:0 12px 28px color-mix(in srgb,var(--color-ai-office) 14%,transparent)}.hero-card:active{transform:scale(.985)}.feature-icon{width:52px;height:52px;display:grid;place-items:center;border-radius:var(--radius-md);color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 13%,transparent)}.feature-copy{display:grid;gap:7px;color:var(--color-text-secondary);font-size:13px;line-height:1.5}.feature-heading{display:flex;align-items:center;gap:8px}.feature-heading strong{color:var(--color-text);font-size:17px}.feature-heading em{padding:3px 7px;border-radius:var(--radius-pill);color:#357965;background:color-mix(in srgb,#58aa91 13%,transparent);font-size:10px;font-style:normal}.feature-copy small{display:flex;align-items:center;gap:5px;color:var(--color-text-muted)}.chart-mark{color:color-mix(in srgb,var(--color-ai-office) 58%,transparent)}.future-grid{display:grid;grid-template-columns:1fr;gap:10px}.future-grid article{min-height:68px;display:flex;align-items:center;gap:11px;padding:13px;border:1px dashed var(--color-border);border-radius:var(--radius-md);color:var(--color-text-muted);background:color-mix(in srgb,var(--color-surface-soft) 72%,transparent)}.future-grid article>span{width:40px;height:40px;display:grid;place-items:center;border-radius:var(--radius-sm);background:var(--color-surface)}.future-grid article div{display:grid;gap:3px}.future-grid strong{color:var(--color-text-secondary);font-size:14px}.future-grid small{font-size:12px}@keyframes glow-drift{to{transform:translate(-35px,18px) scale(1.08)}}@media(max-width:800px){.feature-grid{grid-template-columns:1fr}}@media(max-width:560px){.ai-intro{grid-template-columns:1fr}.hero-card{grid-template-columns:auto 1fr}.chart-mark{display:none}}@media(prefers-reduced-motion:reduce){.ai-office-panel::before{animation:none}.hero-card:hover{transform:none}}
</style>
