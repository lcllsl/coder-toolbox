<script setup lang="ts">
import { Check, Clock3, HeartPulse } from '@lucide/vue'

import type { ReminderConfig } from '@/features/health/types'

defineProps<{
  reminder: ReminderConfig
  pendingCount: number
}>()

const emit = defineEmits<{
  complete: []
  snooze: []
}>()
</script>

<template>
  <aside class="reminder-card" role="alert" :aria-label="`${reminder.title}提醒`">
    <div class="reminder-card-heading">
      <span class="pulse-icon"><HeartPulse :size="20" /></span>
      <div><span v-if="pendingCount > 1">还有 {{ pendingCount }} 项提醒</span><h2>{{ reminder.title }}</h2></div>
    </div>
    <p>{{ reminder.message }}</p>
    <div class="reminder-card-actions">
      <button class="complete" type="button" @click="emit('complete')"><Check :size="15" />完成</button>
      <button type="button" @click="emit('snooze')"><Clock3 :size="15" />{{ reminder.snoozeMinutes }} 分钟后</button>
    </div>
  </aside>
</template>

<style scoped>
.reminder-card { width: 238px; height: 126px; padding: 12px 13px; border: 1px solid color-mix(in srgb, var(--color-health) 22%, var(--color-border)); border-radius: var(--radius-lg); color: var(--color-text); background: color-mix(in srgb, var(--color-surface) 96%, transparent); box-shadow: 0 8px 22px -10px rgb(22 93 79 / 36%); backdrop-filter: blur(18px) saturate(1.15); }
.reminder-card-heading { display: flex; align-items: center; gap: 9px; }
.pulse-icon { width: 34px; height: 34px; display: grid; place-items: center; border-radius: var(--radius-sm); color: var(--color-health); background: color-mix(in srgb, var(--color-health) 12%, transparent); }
.reminder-card-heading > div { display: grid; gap: 1px; }
.reminder-card-heading span { color: var(--color-health); font-size: 10.5px; }
.reminder-card h2 { margin: 0; font-size: 14px; }
.reminder-card p { height: 30px; margin: 7px 0 5px; color: var(--color-text-secondary); font-size: 12px; line-height: 1.4; }
.reminder-card-actions { display: flex; gap: 7px; }
.reminder-card-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 5px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-pill); color: var(--color-text-secondary); background: var(--color-surface); font-size: 11.5px; cursor: pointer; }
.reminder-card-actions .complete { border-color: transparent; color: #fff; background: var(--color-health); }
</style>
