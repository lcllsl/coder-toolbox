import type { EChartsCoreOption } from 'echarts/core'

import type { ProcessedChart } from '../types'

const COLORS = ['#6f6be8', '#4e8bd7', '#60ad9b', '#df9a55', '#b174bd', '#7e9a58']

export function buildEChartOption(chart: ProcessedChart): EChartsCoreOption {
  const { spec } = chart
  const common = {
    color: COLORS,
    animationDuration: 420,
    aria: { enabled: true, decal: { show: true } },
    textStyle: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: '#4a5362' },
    tooltip: { trigger: spec.type === 'scatter' ? 'item' : 'axis', confine: true },
    legend: { type: 'scroll', bottom: 0, textStyle: { color: '#6b7483' } },
    toolbox: {
      right: 4,
      feature: { saveAsImage: { title: '保存图片', pixelRatio: 2 }, dataView: { title: '查看数据', readOnly: true }, restore: { title: '还原' } },
    },
  }
  if (spec.type === 'pie' || spec.type === 'donut') {
    const series = chart.series[0]
    return {
      ...common,
      tooltip: { trigger: 'item', confine: true },
      grid: undefined,
      series: [{
        name: series?.name ?? spec.title,
        type: 'pie',
        radius: spec.type === 'donut' ? ['43%', '68%'] : '68%',
        center: ['50%', '45%'],
        data: chart.categories.map((name, index) => ({ name, value: (series?.values as number[] | undefined)?.[index] ?? 0 })),
        label: { color: '#5d6572', overflow: 'truncate', width: 100 },
      }],
    }
  }
  if (spec.type === 'scatter') {
    return {
      ...common,
      grid: { left: 48, right: 22, top: 42, bottom: 45, containLabel: true },
      xAxis: { type: 'value', name: spec.categoryField, nameLocation: 'middle', nameGap: 30, splitLine: { lineStyle: { color: '#edf0f5' } } },
      yAxis: { type: 'value', name: spec.valueFields[0], splitLine: { lineStyle: { color: '#edf0f5' } } },
      series: chart.series.map((series) => ({ name: series.name, type: 'scatter', symbolSize: 9, data: series.values })),
    }
  }
  const horizontal = spec.type === 'horizontal-bar'
  const categoryAxis = { type: 'category' as const, data: chart.categories, axisLabel: { color: '#717a88', hideOverlap: true }, axisLine: { lineStyle: { color: '#dfe3ea' } } }
  const valueAxis = { type: 'value' as const, splitLine: { lineStyle: { color: '#edf0f5' } } }
  return {
    ...common,
    grid: { left: 34, right: 22, top: 42, bottom: 50, containLabel: true },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    dataZoom: ['line', 'area'].includes(spec.type) && chart.categories.length > 12
      ? [{ type: 'inside', start: 0, end: 60 }, { type: 'slider', height: 16, bottom: 24 }]
      : undefined,
    series: chart.series.map((series) => ({
      name: series.name,
      type: spec.type === 'line' || spec.type === 'area' ? 'line' : 'bar',
      smooth: ['line', 'area'].includes(spec.type),
      areaStyle: spec.type === 'area' ? { opacity: 0.14 } : undefined,
      barMaxWidth: 38,
      data: series.values,
    })),
  }
}
