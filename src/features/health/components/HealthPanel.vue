<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { Component } from 'vue'
import { Bell, BellOff, Clock3, Coffee, Droplets, Eye, HeartPulse, LucideMoonStar, Pause, PersonStanding, Play, Plus, Trash2, X } from '@lucide/vue'

import { useFeedbackStore } from '@/app/stores/feedback'
import { useHealthStore } from '@/app/stores/health'
import UiConfirmDialog from '@/components/ui/UiConfirmDialog.vue'
import type { ReminderId } from '@/features/health/types'
import { triggerHealthDebugReminder } from '@/services/tauri/health'

const health = useHealthStore()
const feedback = useFeedbackStore()
const savingId = ref<ReminderId>()
const showCreate = ref(false)
const creating = ref(false)
const deleteId = ref<ReminderId>()
const draft = reactive({ title: '', message: '', intervalMinutes: 45, enabled: true })
const icons: Record<string, Component> = { stand: PersonStanding, water: Droplets, pelvic_floor: HeartPulse, eye_rest: Eye, posture: Coffee }
const nextReminder = computed(() =>
  [...health.settings.reminders]
    .filter((item) => item.enabled && item.nextTriggerAt)
    .sort((a, b) => new Date(a.nextTriggerAt!).getTime() - new Date(b.nextTriggerAt!).getTime())[0],
)
const deleteTitle = computed(() => health.settings.reminders.find((reminder) => reminder.id === deleteId.value)?.title ?? '该提醒')

function reminderIcon(id: ReminderId) {
  return icons[id] ?? Bell
}

function resetDraft() {
  draft.title = ''
  draft.message = ''
  draft.intervalMinutes = 45
  draft.enabled = true
  showCreate.value = false
}

async function updateReminder(id: ReminderId, patch: { enabled?: boolean; intervalMinutes?: number; snoozeMinutes?: number }) {
  savingId.value = id
  try { await health.updateReminder(id, patch); feedback.notify('提醒设置已保存', 'success') }
  catch { feedback.notify('提醒间隔必须在 5～1440 分钟之间', 'warning') }
  finally { savingId.value = undefined }
}
async function pause(minutes: 30 | 60) { await health.pause(minutes); feedback.notify(`提醒已暂停 ${minutes} 分钟`) }
async function muteToday() { await health.muteToday(); feedback.notify('今天将不再显示健康提醒') }
async function debugTrigger(id: ReminderId) {
  feedback.notify('正在触发调试提醒')
  await triggerHealthDebugReminder(id)
}
async function addReminder() {
  creating.value = true
  try {
    await health.addReminder(draft)
    feedback.notify('提醒项目已新增', 'success')
    resetDraft()
  } catch {
    feedback.notify('请填写标题、介绍和 5～1440 分钟的间隔', 'warning')
  } finally { creating.value = false }
}
async function confirmDelete() {
  const id = deleteId.value
  deleteId.value = undefined
  if (!id) return
  await health.deleteReminder(id)
  feedback.notify('提醒项目已删除', 'success')
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

    <div class="reminder-heading">
      <div><strong>提醒项目</strong><small>共 {{ health.settings.reminders.length }} 项，可按需要新增或删除</small></div>
      <button type="button" :aria-expanded="showCreate" @click="showCreate = !showCreate"><X v-if="showCreate" :size="15" /><Plus v-else :size="15" />{{ showCreate ? '取消新增' : '新增提醒' }}</button>
    </div>

    <form v-if="showCreate" class="reminder-create" @submit.prevent="addReminder">
      <label>项目标题<input v-model.trim="draft.title" type="text" maxlength="24" required placeholder="例如：伸展肩颈" /></label>
      <label>间隔时间<span class="interval-input"><input v-model.number="draft.intervalMinutes" aria-label="新增提醒间隔时间" type="number" min="5" max="1440" step="1" required /><em>分钟</em></span></label>
      <label class="message-field">项目介绍<textarea v-model.trim="draft.message" maxlength="80" required placeholder="提醒弹出时显示的简短介绍" /></label>
      <label class="create-enabled"><input v-model="draft.enabled" type="checkbox" /><span><strong>新增后启用</strong><small>从保存时开始计算首次提醒</small></span></label>
      <button class="create-submit" type="submit" :disabled="creating"><Plus :size="14" />{{ creating ? '正在保存' : '新增项目' }}</button>
    </form>

    <div class="reminder-list">
      <div v-if="!health.settings.reminders.length" class="reminder-empty"><Bell :size="24" /><strong>还没有提醒项目</strong><span>点击“新增提醒”创建第一项。</span></div>
      <article v-for="reminder in health.settings.reminders" :key="reminder.id" class="reminder-row" :class="{ disabled: !reminder.enabled }">
        <span class="reminder-icon"><component :is="reminderIcon(reminder.id)" :size="19" /></span>
        <div class="reminder-copy"><strong>{{ reminder.title }}</strong><span>{{ reminder.message }}</span></div>
        <label class="reminder-field">间隔<span class="row-interval"><input type="number" min="5" max="1440" step="1" :aria-label="`${reminder.title}间隔时间`" :value="reminder.intervalMinutes" :disabled="savingId === reminder.id" @change="updateReminder(reminder.id, { intervalMinutes: Number(($event.target as HTMLInputElement).value) })" /><em>分</em></span></label>
        <label class="reminder-field">稍后<select :value="reminder.snoozeMinutes" :disabled="savingId === reminder.id" @change="updateReminder(reminder.id, { snoozeMinutes: Number(($event.target as HTMLSelectElement).value) })"><option v-for="minute in [5, 10, 15, 20]" :key="minute" :value="minute">{{ minute }} 分钟</option></select></label>
        <label class="switch"><input type="checkbox" :checked="reminder.enabled" :aria-label="`${reminder.title}提醒`" @change="updateReminder(reminder.id, { enabled: ($event.target as HTMLInputElement).checked })" /><span /></label>
        <span class="completion-count">今日 {{ health.completedToday[reminder.id] ?? 0 }} 次</span>
        <button class="debug-trigger" type="button" :aria-label="`立即调试${reminder.title}提醒`" @click="debugTrigger(reminder.id)"><Play :size="10" />调试</button>
        <button class="delete-trigger" type="button" :aria-label="`删除${reminder.title}提醒`" title="删除提醒" @click="deleteId = reminder.id"><Trash2 :size="13" /></button>
      </article>
    </div>

    <div class="health-policies">
      <label class="policy-toggle"><LucideMoonStar :size="17" /><span><strong>全局静默模式</strong><small>保留计划和统计，暂停弹出提醒</small></span><input type="checkbox" :checked="health.settings.silentMode" @change="health.setSilentMode(($event.target as HTMLInputElement).checked)" /></label>
      <div class="quiet-hours"><div><strong>勿扰时间</strong><small>时段结束后重新计算，不集中补发</small></div><input type="checkbox" aria-label="启用勿扰时间" :checked="health.settings.quietHours.enabled" @change="health.updateQuietHours({ enabled: ($event.target as HTMLInputElement).checked })" /><input type="time" aria-label="勿扰开始时间" :value="health.settings.quietHours.start" @change="health.updateQuietHours({ start: ($event.target as HTMLInputElement).value })" /><span>至</span><input type="time" aria-label="勿扰结束时间" :value="health.settings.quietHours.end" @change="health.updateQuietHours({ end: ($event.target as HTMLInputElement).value })" /></div>
    </div>
    <UiConfirmDialog :open="Boolean(deleteId)" title="删除提醒项目？" :message="`删除“${deleteTitle}”后将停止后续提醒，已有日志仍保留在本地统计记录中。`" confirm-label="删除" @cancel="deleteId = undefined" @confirm="confirmDelete" />
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
.reminder-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.reminder-heading > div { display: grid; gap: 2px; }
.reminder-heading strong { font-size: var(--font-size-body); }
.reminder-heading small { color: var(--color-text-muted); font-size: var(--font-size-caption); }
.reminder-heading button, .create-submit { display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 6px 10px; border: 1px solid color-mix(in srgb, var(--color-health) 30%, var(--color-border)); border-radius: var(--radius-pill); color: var(--color-health); background: color-mix(in srgb, var(--color-health) 7%, var(--color-surface)); font-size: var(--font-size-button); cursor: pointer; }
.reminder-create { display: grid; grid-template-columns: minmax(0, 1fr) 112px; gap: 9px 11px; padding: 12px; border: 1px solid color-mix(in srgb, var(--color-health) 24%, var(--color-border)); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--color-health) 5%, var(--color-surface-soft)); }
.reminder-create label { display: grid; gap: 4px; color: var(--color-text-secondary); font-size: var(--font-size-caption); }
.reminder-create input[type='text'], .reminder-create input[type='number'], .reminder-create textarea { width: 100%; min-width: 0; padding: 7px 9px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); color: var(--color-text); background: var(--color-surface); font: inherit; font-size: var(--font-size-body-compact); }
.reminder-create textarea { min-height: 58px; resize: vertical; line-height: 1.45; }
.message-field { grid-column: 1 / -1; }
.interval-input { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 5px; }
.interval-input em { color: var(--color-text-muted); font-size: var(--font-size-caption); font-style: normal; }
.create-enabled { display: flex !important; align-items: center; gap: 7px !important; }
.create-enabled input { accent-color: var(--color-health); }
.create-enabled span { display: grid; gap: 1px; }
.create-enabled strong { color: var(--color-text); font-size: var(--font-size-body-compact); }
.create-enabled small { color: var(--color-text-muted); font-size: var(--font-size-caption); }
.create-submit { justify-self: end; align-self: center; }
.reminder-list { display: grid; gap: 7px; }
.reminder-empty { min-height: 116px; display: grid; place-items: center; align-content: center; gap: 5px; border: 1px dashed var(--color-border); border-radius: var(--radius-sm); color: var(--color-text-muted); text-align: center; }
.reminder-empty strong { color: var(--color-text); font-size: var(--font-size-body); }
.reminder-empty span { font-size: var(--font-size-caption); }
.reminder-row { position: relative; display: grid; grid-template-columns: 38px minmax(150px, 1fr) 82px 76px 38px; align-items: center; gap: 9px; padding: 10px 12px 19px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface-soft); transition: opacity var(--duration-fast); }
.reminder-row.disabled { opacity: .58; }
.reminder-icon { width: 36px; height: 36px; display: grid; place-items: center; border-radius: var(--radius-sm); color: var(--color-health); background: color-mix(in srgb, var(--color-health) 11%, transparent); }
.reminder-copy { min-width: 0; display: grid; gap: 2px; }
.reminder-copy strong { font-size: 13px; }
.reminder-copy span { overflow: hidden; color: var(--color-text-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.reminder-field { display: grid; gap: 2px; color: var(--color-text-muted); font-size: 10.5px; }
.reminder-field select, .reminder-field input { min-width: 0; padding: 4px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); color: var(--color-text); background: var(--color-surface); font-size: 11.5px; }
.row-interval { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 3px; }
.row-interval input { width: 100%; }
.row-interval em { color: var(--color-text-muted); font-size: 10px; font-style: normal; }
.completion-count { position: absolute; left: 59px; bottom: 5px; color: var(--color-health); font-size: 10.5px; }
.debug-trigger { position: absolute; right: 37px; bottom: 4px; display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; border: 0; border-radius: var(--radius-pill); color: var(--color-text-muted); background: transparent; font-size: 9.5px; cursor: pointer; }
.debug-trigger:hover { color: var(--color-health); background: color-mix(in srgb, var(--color-health) 9%, transparent); }
.delete-trigger { position: absolute; right: 10px; bottom: 3px; width: 24px; height: 24px; display: grid; place-items: center; border: 0; border-radius: 50%; color: var(--color-text-muted); background: transparent; cursor: pointer; }
.delete-trigger:hover { color: #d45d61; background: color-mix(in srgb, #d45d61 9%, transparent); }
.debug-trigger:focus-visible, .delete-trigger:focus-visible, .reminder-heading button:focus-visible, .reminder-create input:focus-visible, .reminder-create textarea:focus-visible, .create-submit:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 1px; }
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
@media (max-width: 460px) { .health-summary { grid-template-columns: 1fr 1fr; } .summary-actions { grid-column: 1 / -1; justify-content: flex-start; } .reminder-create { grid-template-columns: 1fr; } .message-field { grid-column: auto; } .create-submit { justify-self: stretch; } .reminder-row { grid-template-columns: 38px 1fr 38px; } .reminder-field { display: none; } .quiet-hours { grid-template-columns: 1fr auto 76px auto 76px; } .quiet-hours > div { grid-column: 1 / -1; } }
</style>
