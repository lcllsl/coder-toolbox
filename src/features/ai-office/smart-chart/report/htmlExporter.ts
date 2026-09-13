import type { BuiltReport } from '../types'
import { buildEChartOption } from './echartsBuilder'

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export function createReportFileName(report: BuiltReport): string {
  const base = report.spec.reportTitle.replace(/[\\/:*?"<>|]/g, '-').trim() || '智能图表报告'
  return `${base}.html`
}

export async function exportReportHtml(report: BuiltReport): Promise<string> {
  const { default: echartsRuntime } = await import('echarts/dist/echarts.min.js?raw')
  const payload = {
    title: report.spec.reportTitle,
    subtitle: report.spec.reportSubtitle,
    source: report.source,
    kpis: report.kpis.map(({ label, displayValue }) => ({ label, displayValue })),
    charts: report.charts.map((chart) => ({ title: chart.spec.title, description: chart.spec.description ?? '', option: buildEChartOption(chart) })),
  }
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${report.spec.reportTitle.replace(/[<>&"']/g, '')}</title>
<style>:root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#26303f;background:#f4f6fa}*{box-sizing:border-box}body{margin:0;padding:30px}.page{max-width:1440px;margin:auto}.head{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;margin-bottom:22px}.head h1{margin:0;font-size:28px}.head p,.source{margin:7px 0 0;color:#6d7684}.source{text-align:right;font-size:13px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}.kpi,.card{background:#fff;border:1px solid #e4e8ef;border-radius:18px;box-shadow:0 8px 26px rgba(38,48,63,.06)}.kpi{padding:18px}.kpi span{display:block;color:#7a8391;font-size:13px}.kpi strong{display:block;margin-top:8px;font-size:25px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.card{padding:16px}.card h2{margin:0;font-size:17px}.card p{min-height:20px;margin:5px 0 0;color:#7a8391;font-size:13px}.chart{height:360px;margin-top:4px}@media(max-width:900px){body{padding:18px}.kpis{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}@media(max-width:520px){.head{display:block}.source{text-align:left}.kpis{grid-template-columns:1fr}.chart{height:320px}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}</style>
</head><body><main class="page"><header class="head"><div><h1 id="title"></h1><p id="subtitle"></p></div><div class="source" id="source"></div></header><section class="kpis" id="kpis"></section><section class="grid" id="charts"></section></main>
<script>${echartsRuntime}</script><script>const REPORT=${safeJson(payload)};document.getElementById('title').textContent=REPORT.title;document.getElementById('subtitle').textContent=REPORT.subtitle;document.getElementById('source').textContent=REPORT.source.fileName+' · '+REPORT.source.sheetName+' · '+REPORT.source.rowCount+' 条记录';const kpis=document.getElementById('kpis');REPORT.kpis.forEach(k=>{const el=document.createElement('article');el.className='kpi';const label=document.createElement('span');label.textContent=k.label;const value=document.createElement('strong');value.textContent=k.displayValue;el.append(label,value);kpis.append(el)});const instances=[];const charts=document.getElementById('charts');REPORT.charts.forEach((c,i)=>{const card=document.createElement('article');card.className='card';const h=document.createElement('h2');h.textContent=c.title;const p=document.createElement('p');p.textContent=c.description;const box=document.createElement('div');box.className='chart';box.id='chart-'+i;card.append(h,p,box);charts.append(card);const instance=echarts.init(box);instance.setOption(c.option);instances.push(instance)});addEventListener('resize',()=>instances.forEach(c=>c.resize()));</script></body></html>`
}
