<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { BellOff, Clock3, Coffee, Droplets, Eye, HeartPulse, LucideMoonStar, Pause, PersonStanding, Play } from '@lucide/vue'

import { useFeedbackStore } from '@/app/stores/feedback'
import { useHealthStore } from '@/app/stores/health'
import type { ReminderId } from '@/features/health/types'
import { triggerHealthDebugReminder } from '@/services/tauri/health'

const health = useHealthStore()
const feedback = useFeedbackStore()
const savingId = ref<ReminderId>()
const icons = { stand: PersonStanding, water: Droplets, pelvic_floor: HeartPulse, eye_rest: Eye, posture: Coffee }
const nextReminder = computed(() =>
  [...health.settings.reminders]
    .filter((item) => item.enabled && item.nextTriggerAt)
    .sort((a, b) => new Date(a.nextTriggerAt!).getTime() - new Date(b.nextTriggerAt!).getTime())[0],
)

async function updateReminder(id: ReminderId, patch: { enabled?: boolean; intervalMinutes?: number; snoozeMinutes?: number }) {
  savingId.value = id
  try { await health.updateReminder(id, patch); feedback.notify('提醒设置已保存', 'success') }
  finally { savingId.value = undefined }
}
async function pause(minutes: 30 | 60) { await health.pause(minutes); feedback.notify(`提醒已暂停 ${minutes} 分钟`) }
async function muteToday() { await health.muteToday(); feedback.notify('今天将不再显示健康提醒') }
async function debugTrigger(id: ReminderId) {
  feedback.notify('正在触发调试提醒')
  await triggerHealthDebugReminder(id)
}

onMounted(() => { if (!health.initialized) void health.initialize() })
</script>

<template>
  <section class="health-panel">
    <div class="health-summary">
      <div><span>今日完成</span><strong>{{ health.totalCompletedToday }}</strong><small>次健康行动</small></div>
      <div><span>下一项</span><strong class="next-title">{{ nextReminder?.title ?? '暂无提醒' }}</strong><small>{{ nextReminder?.nextTriggerAt ? new Date(nextReminder.nextTriggerAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '启用提醒后开始计时' }}</small></div>
      <div class="summary-actions">
        <button type="button" @click="pause(30)"><Pause :size="14" />暂停 30 分钟</button>
        <button type="button" @click="pause(60)"><Clock3 :size="14" />暂停 1 小时</button>
        <button type="button" @click="muteToday"><BellOff :size="14" />今日不再提醒</button>
      </div>
    </div>

    <div class="reminder-list">
      <article v-for="reminder in health.settings.reminders" :key="reminder.id" class="reminder-row" :class="{ disabled: !reminder.enabled }">
        <span class="reminder-icon"><component :is="icons[reminder.id]" :size="19" /></span>
        <div class="reminder-copy"><strong>{{ reminder.title }}</strong><span>{{ reminder.message }}</span></div>
        <label class="reminder-field">间隔<select :value="reminder.intervalMinutes" :disabled="savingId === reminder.id" @change="updateReminder(reminder.id, { intervalMinutes: Number(($event.target as HTMLSelectElement).value) })"><option v-for="minute in [20, 30, 40, 45, 50, 60, 90]" :key="minute" :value="minute">{{ minute }} 分钟</option></select></label>
        <label class="reminder-field">稍后<select :value="reminder.snoozeMinutes" :disabled="savingId === reminder.id" @change="updateReminder(reminder.id, { snoozeMinutes: Number(($event.target as HTMLSelectElement).value) })"><option v-for="minute in [5, 10, 15, 20]" :key="minute" :value="minute">{{ minute }} 分钟</option></select></label>
        <label class="switch"><input type="checkbox" :checked="reminder.enabled" :aria-label="`${reminder.title}提醒`" @change="updateReminder(reminder.id, { enabled: ($event.target as HTMLInputElement).checked })" /><span /></label>
        <span class="completion-count">今日 {{ health.completedToday[reminder.id] ?? 0 }} 次</span>
        <button class="debug-trigger" type="button" :aria-label="`立即调试${reminder.title}提醒`" @click="debugTrigger(reminder.id)"><Play :size="10" />调试</button>
      </article>
    </div>

    <div class="health-policies">
      <label class="policy-toggle"><LucideMoonStar :size="17" /><span><strong>全局静默模式</strong><small>保留计划和统计，暂停弹出提醒</small></span><input type="checkbox" :checked="health.settings.silentMode" @change="health.setSilentMode(($event.target as HTMLInputElement).checked)" /></label>
      <div class="quiet-hours"><div><strong>勿扰时间</strong><small>时段结束后重新计算，不集中补发</small></div><input type="checkbox" aria-label="启用勿扰时间" :checked="health.settings.quietHours.enabled" @change="health.updateQuietHours({ enabled: ($event.target as HTMLInputElement).checked })" /><input type="time" aria-label="勿扰开始时间" :value="health.settings.quietHours.start" @change="health.updateQuietHours({ start: ($event.target as HTMLInputElement).value })" /><span>至</span><input type="time" aria-label="勿扰结束时间" :value="health.settings.quietHours.end" @change="health.updateQuietHours({ end: ($event.target as HTMLInputElement).value })" /></div>
    </div>
  </section>
</template>

<style scoped>
.health-panel { display: grid; gap: 12px; color: var(--color-text); }
.health-summary { display: grid; grid-template-columns: 76px minmax(92px, 1fr) auto; gap: 8px; padding: 14px; border-radius: var(--radius-md); background: color-mix(in srgb, var(--color-health) 9%, var(--color-surface-soft)); }
.health-summary > div:not(.summary-actions) { display: grid; align-content: center; gap: 2px; }
.health-summary span, .health-summary small { color: var(--color-text-muted); font-size: 12.5px; }
.health-summary strong { color: var(--color-health); font-size: 25px; }
.health-summary .next-title { color: var(--color-text); font-size: 15px; }
.summary-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-content: center; gap: 6px; }
.summary-actions button { display: inline-flex; align-items: center; gap: 5px; padding: 6px 9px; border: 1px solid var(--color-border); border-radius: var(--radius-pill); color: var(--color-text-secondary); background: var(--color-surface); font-size: 12px; cursor: pointer; }
.reminder-list { display: grid; gap: 7px; }
.reminder-row { position: relative; display: grid; grid-template-columns: 38px minmax(150px, 1fr) 82px 76px 38px; align-items: center; gap: 9px; padding: 10px 12px 19px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface-soft); transition: opacity var(--duration-fast); }
.reminder-row.disabled { opacity: .58; }
.reminder-icon { width: 36px; height: 36px; display: grid; place-items: center; border-radius: var(--radius-sm); color: var(--color-health); background: color-mix(in srgb, var(--color-health) 11%, transparent); }
.reminder-copy { min-width: 0; display: grid; gap: 2px; }
.reminder-copy strong { font-size: 13px; }
.reminder-copy span { overflow: hidden; color: var(--color-text-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.reminder-field { display: grid; gap: 2px; color: var(--color-text-muted); font-size: 10.5px; }
.reminder-field select { min-width: 0; padding: 4px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); color: var(--color-text); background: var(--color-surface); font-size: 11.5px; }
.completion-count { position: absolute; left: 59px; bottom: 5px; color: var(--color-health); font-size: 10.5px; }
.debug-trigger { position: absolute; right: 12px; bottom: 4px; display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; border: 0; border-radius: var(--radius-pill); color: var(--color-text-muted); background: transparent; font-size: 9.5px; cursor: pointer; }
.debug-trigger:hover { color: var(--color-health); background: color-mix(in srgb, var(--color-health) 9%, transparent); }
.debug-trigger:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 1px; }
.switch input { position: absolute; opacity: 0; }
.switch span { width: 34px; height: 20px; display: block; padding: 2px; border-radius: var(--radius-pill); background: var(--color-border); cursor: pointer; }
.switch span::after { content: ''; width: 16px; height: 16px; display: block; border-radius: 50%; background: #fff; transition: transform var(--duration-fast); }
.switch input:checked + span { background: var(--color-health); }
.switch input:checked + span::after { transform: translateX(14px); }
.health-policies { display: grid; grid-template-columns: 1fr; gap: 8px; }
.policy-toggle, .quiet-hours { min-height: 62px; align-items: center; gap: 9px; padding: 10px 12px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface-soft); }
.policy-toggle { display: flex; }
.quiet-hours { display: grid; grid-template-columns: minmax(170px, 1fr) auto 76px auto 76px; }
.policy-toggle > span, .quiet-hours > div { flex: 1; display: grid; gap: 2px; }
.policy-toggle strong, .quiet-hours strong { font-size: 12.5px; }
.policy-toggle small, .quiet-hours small { color: var(--color-text-muted); font-size: 10.5px; }
.policy-toggle input { accent-color: var(--color-health); }
.quiet-hours input[type='time'] { width: 76px; padding: 4px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); color: var(--color-text); background: var(--color-surface); font-size: 11px; }
.quiet-hours > span { color: var(--color-text-muted); font-size: 11px; }
@media (max-width: 460px) { .health-summary { grid-template-columns: 1fr 1fr; } .summary-actions { grid-column: 1 / -1; justify-content: flex-start; } .reminder-row { grid-template-columns: 38px 1fr 38px; } .reminder-field { display: none; } .quiet-hours { grid-template-columns: 1fr auto 76px auto 76px; } .quiet-hours > div { grid-column: 1 / -1; } }
</style>
