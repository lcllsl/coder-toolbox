<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { AppWindow, Database, Keyboard, MonitorUp, MousePointer2, Palette, PauseCircle, Play, Power, RotateCcw, Trash2, VolumeX } from '@lucide/vue'

import { useFeedbackStore } from '@/app/stores/feedback'
import { usePanelStore, type ThemePreference } from '@/app/stores/panel'
import { useSettingsStore } from '@/app/stores/settings'
import UiConfirmDialog from '@/components/ui/UiConfirmDialog.vue'
import { validateGlobalShortcut } from '@/features/settings/core/shortcuts'
import type { AppMode, DoubleClickAction } from '@/features/settings/types'
import { exitApplication, onAppSettingsChanged, onTrayModeRequested } from '@/services/tauri/settings'

type SettingsView = 'general' | 'behavior' | 'data'
type ConfirmAction = 'clear-keep' | 'clear-reset' | 'exit'

const settings = useSettingsStore()
const panel = usePanelStore()
const feedback = useFeedbackStore()
const activeView = ref<SettingsView>('general')
const shortcutInput = ref('')
const shortcutError = ref('')
const saving = ref(false)
const confirmAction = ref<ConfirmAction>()
let unlistenSettings: (() => void) | undefined
let unlistenTrayMode: (() => void) | undefined

const sizeLabel = computed(() => `${settings.settings.orbSize}px`)
const opacityLabel = computed(() => `${Math.round(settings.settings.orbOpacity * 100)}%`)
const confirmTitle = computed(() => confirmAction.value === 'exit' ? '退出冒泡？' : '清除全部本地数据？')
const confirmMessage = computed(() => {
  if (confirmAction.value === 'exit') return '退出后剪贴板监听和健康提醒都会停止，可再次手动启动应用。'
  if (confirmAction.value === 'clear-reset') return '将删除剪贴板历史、图片缓存、提醒统计、临时中转和最近使用，并恢复所有设置。原始文件不会被删除。'
  return '将删除剪贴板历史、图片缓存、提醒统计、临时中转和最近使用，当前设置和收藏会保留。原始文件不会被删除。'
})

const modes: { id: AppMode; label: string; description: string; icon: typeof Play }[] = [
  { id: 'work', label: '工作模式', description: '正常记录剪贴板并显示健康提醒', icon: Play },
  { id: 'silent', label: '静默模式', description: '继续记录剪贴板，暂停提醒弹卡', icon: VolumeX },
  { id: 'paused', label: '完全暂停', description: '暂停提醒展示和剪贴板记录', icon: PauseCircle },
]

async function setTheme(theme: ThemePreference) {
  try { await panel.setTheme(theme); feedback.notify('外观主题已更新', 'success') }
  catch { feedback.notify('主题保存失败', 'warning') }
}

async function saveShortcut() {
  const result = validateGlobalShortcut(shortcutInput.value)
  shortcutError.value = result.error ?? ''
  if (!result.value) return
  saving.value = true
  try {
    await settings.setGlobalShortcut(result.value)
    shortcutInput.value = result.value
    feedback.notify('全局快捷键已生效', 'success')
  } catch {
    shortcutError.value = '注册失败，该组合可能已被其他应用占用'
  } finally { saving.value = false }
}

async function setMode(mode: AppMode) {
  try { await settings.setMode(mode); feedback.notify(`${modes.find((item) => item.id === mode)?.label}已启用`, 'success') }
  catch { feedback.notify('模式切换失败', 'warning') }
}

async function setDoubleClick(action: DoubleClickAction) {
  await settings.setDoubleClickAction(action)
  feedback.notify('双击动作已更新', 'success')
}

async function toggleAutostart(enabled: boolean) {
  try { await settings.setAutostart(enabled); feedback.notify(enabled ? '已开启开机启动' : '已关闭开机启动', 'success') }
  catch { feedback.notify('开机启动设置失败，开发模式下可能不可用', 'warning') }
}

async function saveAppearance() {
  await settings.setOrbAppearance(settings.settings.orbSize, settings.settings.orbOpacity)
}

async function confirmDangerousAction() {
  const action = confirmAction.value
  confirmAction.value = undefined
  if (action === 'exit') { await exitApplication(); return }
  saving.value = true
  try {
    await settings.clearLocalData(action === 'clear-reset')
    shortcutInput.value = settings.settings.globalShortcut
    feedback.notify(action === 'clear-reset' ? '本地数据已清除，设置已重置' : '本地数据已清除，设置已保留', 'success')
  } catch { feedback.notify('清理未能全部完成，请重试', 'warning') }
  finally { saving.value = false }
}

onMounted(async () => {
  await Promise.all([settings.initialize(), panel.initialize()])
  shortcutInput.value = settings.settings.globalShortcut
  unlistenSettings = await onAppSettingsChanged(async () => {
    await settings.reload()
    shortcutInput.value = settings.settings.globalShortcut
  })
  unlistenTrayMode = await onTrayModeRequested(async (mode) => {
    settings.settings.mode = mode
  })
})

onUnmounted(() => { unlistenSettings?.(); unlistenTrayMode?.() })
</script>

<template>
  <section class="settings-panel">
    <nav class="settings-tabs" aria-label="设置分类"><button type="button" :class="{ active: activeView === 'general' }" @click="activeView = 'general'"><Palette :size="16" />常规</button><button type="button" :class="{ active: activeView === 'behavior' }" @click="activeView = 'behavior'"><Keyboard :size="16" />行为</button><button type="button" :class="{ active: activeView === 'data' }" @click="activeView = 'data'"><Database :size="16" />数据与应用</button></nav>

    <section v-if="activeView === 'general'" class="settings-section">
      <header><h2>外观主题</h2><p>跟随系统或固定使用浅色、深色外观。</p></header>
      <div class="theme-options" role="radiogroup" aria-label="外观主题"><button v-for="option in (['system', 'light', 'dark'] as ThemePreference[])" :key="option" type="button" role="radio" :aria-checked="panel.theme === option" :class="{ selected: panel.theme === option }" @click="setTheme(option)"><span class="theme-swatch" :data-theme-preview="option" />{{ { system: '跟随系统', light: '浅色', dark: '深色' }[option] }}</button></div>
      <div class="setting-card appearance-card"><span class="setting-icon"><MousePointer2 :size="19" /></span><div><strong>悬浮球尺寸</strong><small>调整主体视觉大小，点击区域始终不小于 48px。</small><input v-model.number="settings.settings.orbSize" aria-label="悬浮球尺寸" type="range" min="48" max="68" step="2" @change="saveAppearance" /></div><output>{{ sizeLabel }}</output></div>
      <div class="setting-card appearance-card"><span class="setting-icon"><Palette :size="19" /></span><div><strong>悬浮球透明度</strong><small>降低透明度可减少桌面干扰。</small><input v-model.number="settings.settings.orbOpacity" aria-label="悬浮球透明度" type="range" min="0.6" max="1" step="0.05" @change="saveAppearance" /></div><output>{{ opacityLabel }}</output></div>
      <label class="setting-card toggle-card"><span class="setting-icon"><MonitorUp :size="19" /></span><span><strong>开机自动启动</strong><small>启动后只显示悬浮球，不主动打开功能面板。</small></span><input type="checkbox" :checked="settings.settings.autostart" @change="toggleAutostart(($event.target as HTMLInputElement).checked)" /></label>
    </section>

    <section v-else-if="activeView === 'behavior'" class="settings-section">
      <header><h2>运行模式</h2><p>模式会同时影响健康提醒和剪贴板监听。</p></header>
      <div class="mode-grid"><button v-for="mode in modes" :key="mode.id" type="button" :aria-pressed="settings.settings.mode === mode.id" :class="{ active: settings.settings.mode === mode.id }" @click="setMode(mode.id)"><component :is="mode.icon" :size="19" /><strong>{{ mode.label }}</strong><small>{{ mode.description }}</small></button></div>
      <div class="setting-block"><label for="global-shortcut"><strong>全局快捷键</strong><small>新组合注册成功后才会释放旧快捷键。</small></label><div class="shortcut-input"><input id="global-shortcut" v-model="shortcutInput" spellcheck="false" @keydown.enter.prevent="saveShortcut" /><button type="button" :disabled="saving" @click="saveShortcut">应用</button></div><p v-if="shortcutError" class="field-error" role="alert">{{ shortcutError }}</p></div>
      <div class="setting-block"><label for="double-click-action"><strong>双击悬浮球</strong><small>启用后，单击会等待 280ms 以区分双击。</small></label><select id="double-click-action" :value="settings.settings.doubleClickAction" @change="setDoubleClick(($event.target as HTMLSelectElement).value as DoubleClickAction)"><option value="none">不设置双击动作</option><option value="quick-actions">打开快捷入口</option><option value="clipboard">打开剪贴板</option><option value="dev-tools">打开开发转换</option></select></div>
    </section>

    <section v-else class="settings-section data-section">
      <header><h2>本地数据</h2><p>数据只保存在本机。清理操作不会删除用户的原始文件。</p></header>
      <div class="data-summary"><Database :size="23" /><div><strong>清理范围</strong><p>剪贴板历史与图片缓存、健康提醒统计、临时中转副本和最近使用记录。</p></div></div>
      <button class="data-action" type="button" :disabled="saving" @click="confirmAction = 'clear-keep'"><Trash2 :size="17" /><span><strong>清除数据并保留设置</strong><small>保留主题、收藏、常用入口、快捷键和提醒配置</small></span></button>
      <button class="data-action warning" type="button" :disabled="saving" @click="confirmAction = 'clear-reset'"><RotateCcw :size="17" /><span><strong>清除数据并重置设置</strong><small>恢复所有默认值，并关闭开机启动</small></span></button>
      <div class="exit-area"><div><strong>退出应用</strong><small>关闭面板不会退出，只有此按钮或托盘“退出”会结束进程。</small></div><button type="button" @click="confirmAction = 'exit'"><Power :size="15" />退出应用</button></div>
    </section>

    <UiConfirmDialog :open="Boolean(confirmAction)" :title="confirmTitle" :message="confirmMessage" :confirm-label="confirmAction === 'exit' ? '退出' : '确认清除'" @cancel="confirmAction = undefined" @confirm="confirmDangerousAction" />
  </section>
</template>

<style scoped>
.settings-panel { display: grid; gap: 14px; color: var(--color-text); }.settings-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 5px; border-radius: var(--radius-sm); background: var(--color-surface-soft); }.settings-tabs button { min-height: 38px; display: flex; align-items: center; justify-content: center; gap: 6px; border: 0; border-radius: var(--radius-xs); color: var(--color-text-secondary); background: transparent; font-size: var(--font-size-button); cursor: pointer; }.settings-tabs button.active { color: var(--color-focus); background: var(--color-surface); box-shadow: var(--shadow-sm); }.settings-section { display: grid; gap: 11px; }.settings-section header h2 { margin: 0 0 3px; font-size: 16px; }.settings-section header p { margin: 0; color: var(--color-text-muted); font-size: var(--font-size-caption); }.theme-options { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }.theme-options button { display: grid; gap: 6px; padding: 7px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text); background: transparent; text-align: left; font-size: var(--font-size-button); cursor: pointer; }.theme-options button.selected { border-color: var(--color-focus); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-focus) 15%, transparent); }.theme-swatch { height: 34px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); background: linear-gradient(135deg, #f5f6f9 50%, #242832 50%); }.theme-swatch[data-theme-preview='light'] { background: #f5f6f9; }.theme-swatch[data-theme-preview='dark'] { background: #242832; }.setting-card { min-height: 62px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 9px 11px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface-soft); }.setting-icon { width: 34px; height: 34px; display: grid; place-items: center; border-radius: var(--radius-xs); color: var(--color-focus); background: color-mix(in srgb, var(--color-focus) 10%, transparent); }.setting-card > div, .toggle-card > span:nth-child(2) { min-width: 0; display: grid; gap: 2px; }.setting-card strong, .setting-block strong { font-size: var(--font-size-body-compact); }.setting-card small, .setting-block small { color: var(--color-text-muted); font-size: var(--font-size-caption); }.appearance-card input { width: 100%; margin-top: 4px; accent-color: var(--color-focus); }.appearance-card output { min-width: 38px; color: var(--color-text-secondary); font-size: var(--font-size-body-compact); text-align: right; }.toggle-card input { width: 36px; height: 20px; accent-color: var(--color-focus); }.mode-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }.mode-grid button { min-height: 92px; display: grid; place-items: center; align-content: center; gap: 4px; padding: 8px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); color: var(--color-text-muted); text-align: center; background: var(--color-surface-soft); cursor: pointer; }.mode-grid button strong { color: var(--color-text); font-size: var(--font-size-body-compact); }.mode-grid button small { font-size: 11px; line-height: 1.35; }.mode-grid button.active { color: var(--color-focus); border-color: color-mix(in srgb, var(--color-focus) 42%, var(--color-border)); background: color-mix(in srgb, var(--color-focus) 8%, var(--color-surface)); }.setting-block { display: grid; gap: 6px; padding: 10px 11px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); }.setting-block label { display: grid; gap: 2px; }.shortcut-input { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; }.shortcut-input input, .setting-block select { min-height: 36px; padding: 7px 9px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); color: var(--color-text); background: var(--color-surface-soft); font-size: var(--font-size-body-compact); }.shortcut-input button, .exit-area button { padding: 5px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-pill); color: var(--color-text-secondary); background: var(--color-surface); font-size: var(--font-size-button); cursor: pointer; }.field-error { margin: 0; color: #d4695f; font-size: var(--font-size-caption); }.data-summary { display: flex; gap: 10px; padding: 12px; border-radius: var(--radius-sm); color: var(--color-focus); background: color-mix(in srgb, var(--color-focus) 8%, var(--color-surface)); }.data-summary div { color: var(--color-text); }.data-summary strong { font-size: var(--font-size-body); }.data-summary p { margin: 3px 0 0; color: var(--color-text-secondary); font-size: var(--font-size-body-compact); line-height: 1.45; }.data-action { min-height: 62px; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px; padding: 9px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-focus); text-align: left; background: var(--color-surface); cursor: pointer; }.data-action span { display: grid; gap: 2px; }.data-action strong { color: var(--color-text); font-size: var(--font-size-body-compact); }.data-action small { color: var(--color-text-muted); font-size: var(--font-size-caption); }.data-action.warning { color: #d46b55; }.exit-area { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 4px; padding-top: 12px; border-top: 1px solid var(--color-border-subtle); }.exit-area > div { display: grid; gap: 2px; }.exit-area strong { font-size: var(--font-size-body-compact); }.exit-area small { color: var(--color-text-muted); font-size: var(--font-size-caption); }.exit-area button { display: flex; align-items: center; gap: 5px; color: #d45d61; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }@media (max-width: 480px) { .settings-tabs, .theme-options, .mode-grid { grid-template-columns: 1fr; } }
</style>
