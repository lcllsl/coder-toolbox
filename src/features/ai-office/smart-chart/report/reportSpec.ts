import { z } from 'zod'

export const aggregationSchema = z.enum(['sum', 'avg', 'max', 'min', 'count'])
export const chartTypeSchema = z.enum(['bar', 'horizontal-bar', 'line', 'area', 'pie', 'donut', 'scatter'])

export const reportSpecSchema = z.object({
  version: z.literal(1),
  reportTitle: z.string().trim().min(1).max(120),
  reportSubtitle: z.string().trim().max(160).default(''),
  kpis: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(60),
    field: z.string().trim().min(1).max(120),
    aggregation: aggregationSchema,
    format: z.enum(['number', 'currency', 'percentage']),
  })).max(4),
  charts: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().max(220).optional(),
    type: chartTypeSchema,
    categoryField: z.string().trim().min(1).max(120),
    valueFields: z.array(z.string().trim().min(1).max(120)).min(1).max(4),
    aggregation: aggregationSchema,
    sort: z.enum(['none', 'asc', 'desc']).default('none'),
    limit: z.number().int().min(1).max(50).nullable().default(null),
  })).min(3).max(6),
})
