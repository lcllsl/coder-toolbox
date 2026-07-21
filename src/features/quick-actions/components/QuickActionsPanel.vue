<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppWindow, ArrowDown, ArrowUp, CalendarDays, Clock3, Copy, ExternalLink, Fingerprint, Globe2, History, Link, Pencil, Plus, Star, Trash2, X } from '@lucide/vue'

import { useFeedbackStore } from '@/app/stores/feedback'
import { usePanelStore } from '@/app/stores/panel'
import { useQuickActionsStore } from '@/app/stores/quick-actions'
import { createQuickValue, validateQuickUrl } from '@/features/quick-actions/core/quick-values'
import type { QuickCopyAction, QuickLink as QuickLinkItem, RecentFeature } from '@/features/quick-actions/types'
import { writeClipboardText } from '@/services/tauri/clipboard'
import { selectApplication } from '@/services/tauri/quick-actions'
import { CATEGORY_LABELS, type PanelCategory } from '@/types/navigation'

const emit = defineEmits<{ navigate: [category: PanelCategory] }>()
type QuickView = 'overview' | 'copy' | 'links'

const quick = useQuickActionsStore()
const panel = usePanelStore()
const feedback = useFeedbackStore()
const activeView = ref<QuickView>('overview')
const activeLinkType = ref<QuickLinkItem['type']>('url')
const linkName = ref('')
const linkUrl = ref('')
const linkAccent = ref('#f0785f')
const linkError = ref('')
const editingLinkId = ref<string | null>(null)

const copyActions: { id: QuickCopyAction; label: string; hint: string; icon: typeof Clock3 }[] = [
  { id: 'date', label: '当前日期', hint: 'YYYY-MM-DD', icon: CalendarDays },
  { id: 'time', label: '当前时间', hint: 'HH:mm:ss', icon: Clock3 },
  { id: 'datetime', label: '日期时间', hint: '日期 + 时间', icon: CalendarDays },
  { id: 'timestamp-seconds', label: '秒级时间戳', hint: '10 位 Unix 时间', icon: Clock3 },
  { id: 'timestamp-milliseconds', label: '毫秒时间戳', hint: '13 位 Unix 时间', icon: Clock3 },
  { id: 'uuid', label: 'UUID', hint: '随机 v4 标识', icon: Fingerprint },
]

const favoriteCategories = computed(() => panel.favorites.map((category) => ({ category, label: CATEGORY_LABELS[category] })))
const orderedLinks = computed(() => [...quick.links].sort((a, b) => a.sortOrder - b.sortOrder))
const visibleLinks = computed(() => orderedLinks.value.filter((item) => item.type === activeLinkType.value))

async function copyAction(action: QuickCopyAction) {
  const definition = copyActions.find((item) => item.id === action)
  if (!definition) return
  await writeClipboardText(createQuickValue(action))
  await quick.recordRecent(`quick-copy:${action}`, definition.label, 'quick-actions')
  feedback.notify(`${definition.label}已复制`, 'success')
}

async function addUrl() {
  const validation = validateQuickUrl(linkUrl.value)
  linkError.value = validation.error ?? ''
  if (!validation.value) return
  try {
    const saved = editingLinkId.value
      ? await quick.updateUrl(editingLinkId.value, linkName.value, validation.value, linkAccent.value)
      : await quick.addUrl(linkName.value, validation.value, linkAccent.value)
    feedback.notify(saved ? (editingLinkId.value ? '常用网址已更新' : '常用网址已添加') : '该网址已经在列表中', saved ? 'success' : 'neutral')
    if (saved) resetUrlForm()
  } catch { feedback.notify('网址保存失败', 'warning') }
}

function editUrl(item: QuickLinkItem) {
  if (item.type !== 'url') return
  editingLinkId.value = item.id
  linkName.value = item.name
  linkUrl.value = item.target
  linkAccent.value = item.accent
  linkError.value = ''
}

function resetUrlForm() {
  editingLinkId.value = null
  linkName.value = ''
  linkUrl.value = ''
  linkAccent.value = '#f0785f'
  linkError.value = ''
}

function selectLinkType(type: QuickLinkItem['type']) {
  activeLinkType.value = type
  if (type !== 'url') resetUrlForm()
}

async function removeLink(id: string) {
  await quick.removeLink(id)
  if (editingLinkId.value === id) resetUrlForm()
}

async function addApplication() {
  const path = await selectApplication()
  if (!path) return
  try {
    const added = await quick.addApplication(path)
    feedback.notify(added ? '常用应用已添加' : '该应用已经在列表中', added ? 'success' : 'neutral')
  } catch { feedback.notify('所选项目不是可启动的应用', 'warning') }
}

async function openLink(item: QuickLinkItem) {
  try { await quick.openLink(item) }
  catch { feedback.notify(item.enabled ? '打开失败，请稍后重试' : '应用路径已失效', 'warning') }
}

async function useRecent(item: RecentFeature) {
  if (item.id.startsWith('quick-copy:')) {
    await copyAction(item.id.slice('quick-copy:'.length) as QuickCopyAction)
    return
  }
  if (item.id.startsWith('quick-link:')) {
    const link = quick.links.find((value) => `quick-link:${value.id}` === item.id)
    if (link) await openLink(link)
    return
  }
  emit('navigate', item.category)
}

onMounted(() => { void quick.initialize().catch(() => feedback.notify('快捷入口数据加载失败', 'warning')) })
</script>

<template>
  <section class="quick-panel">
    <nav class="quick-tabs" aria-label="快捷入口工具">
      <button type="button" :class="{ active: activeView === 'overview' }" @click="activeView = 'overview'"><History :size="16" />最近与收藏</button>
      <button type="button" :class="{ active: activeView === 'copy' }" @click="activeView = 'copy'"><Copy :size="16" />快捷复制</button>
      <button type="button" :class="{ active: activeView === 'links' }" @click="activeView = 'links'"><Link :size="16" />网址与应用</button>
    </nav>

    <section v-if="activeView === 'overview'" class="quick-section overview-section">
      <div class="section-title"><div><h2>收藏功能</h2><p>在任意功能面板点击右上角星标即可收藏。</p></div><Star :size="18" /></div>
      <div v-if="favoriteCategories.length" class="favorite-grid"><button v-for="item in favoriteCategories" :key="item.category" type="button" @click="emit('navigate', item.category)"><Star :size="15" fill="currentColor" /><span>{{ item.label }}</span></button></div>
      <div v-else class="compact-empty">还没有收藏功能</div>

      <div class="section-title recent-title"><div><h2>最近使用</h2><p>自动保留最近使用的 8 项，同一功能再次使用会回到首位。</p></div><History :size="18" /></div>
      <div v-if="quick.recent.length" class="recent-list"><button v-for="item in quick.recent" :key="item.id" type="button" @click="useRecent(item)"><span>{{ item.label }}</span><small>{{ CATEGORY_LABELS[item.category] }} · 使用 {{ item.useCount }} 次</small><ExternalLink :size="14" /></button></div>
      <div v-else class="compact-empty">使用功能后会自动出现在这里</div>
    </section>

    <section v-else-if="activeView === 'copy'" class="quick-section copy-section">
      <div class="section-title"><div><h2>一键复制</h2><p>点击后直接写入系统剪贴板，不保存额外副本。</p></div></div>
      <div class="copy-grid"><button v-for="item in copyActions" :key="item.id" type="button" @click="copyAction(item.id)"><span><component :is="item.icon" :size="20" /></span><strong>{{ item.label }}</strong><small>{{ item.hint }}</small><Copy :size="14" /></button></div>
    </section>

    <section v-else class="quick-section links-section">
      <div class="section-title"><div><h2>常用网址与应用</h2><p>网址仅允许 HTTP/HTTPS；应用启动前会重新验证路径。</p></div></div>
      <nav class="link-type-tabs" aria-label="常用入口分类"><button type="button" :class="{ active: activeLinkType === 'url' }" @click="selectLinkType('url')"><Globe2 :size="15" />常用网址</button><button type="button" :class="{ active: activeLinkType === 'application' }" @click="selectLinkType('application')"><AppWindow :size="15" />常用应用</button></nav>
      <div v-if="activeLinkType === 'url'" class="url-form" :class="{ editing: editingLinkId }"><input v-model="linkName" aria-label="网址名称" placeholder="名称（可选）" /><input v-model="linkUrl" aria-label="网址地址" placeholder="https://example.com" @keydown.enter.prevent="addUrl" /><input v-model="linkAccent" type="color" aria-label="入口颜色" /><button type="button" @click="addUrl"><Pencil v-if="editingLinkId" :size="15" /><Plus v-else :size="15" />{{ editingLinkId ? '保存修改' : '添加网址' }}</button><button v-if="editingLinkId" class="cancel-edit" type="button" aria-label="取消编辑网址" title="取消编辑" @click="resetUrlForm"><X :size="15" /></button><small v-if="linkError" role="alert">{{ linkError }}</small></div>
      <div v-else class="application-add"><span>选择 macOS 应用或可执行文件添加到快捷入口。</span><button class="add-app" type="button" @click="addApplication"><Plus :size="15" />选择应用</button></div>
      <div v-if="visibleLinks.length" class="link-list"><article v-for="(item, index) in visibleLinks" :key="item.id" :class="{ invalid: !item.enabled, editing: editingLinkId === item.id }"><button class="link-main" type="button" :disabled="!item.enabled" @click="openLink(item)"><span class="link-icon" :style="{ '--link-accent': item.accent }"><Globe2 v-if="item.type === 'url'" :size="18" /><AppWindow v-else :size="18" /></span><span><strong>{{ item.name }}</strong><small :title="item.target">{{ item.enabled ? item.target : '路径已失效' }}</small></span></button><button v-if="item.type === 'url'" type="button" aria-label="编辑网址" title="编辑" @click="editUrl(item)"><Pencil :size="14" /></button><span v-else class="action-spacer" /><button type="button" aria-label="上移入口" :disabled="index === 0" @click="quick.moveLink(item.id, -1, item.type)"><ArrowUp :size="14" /></button><button type="button" aria-label="下移入口" :disabled="index === visibleLinks.length - 1" @click="quick.moveLink(item.id, 1, item.type)"><ArrowDown :size="14" /></button><button type="button" aria-label="删除入口" @click="removeLink(item.id)"><Trash2 :size="14" /></button></article></div>
      <div v-else class="compact-empty link-empty"><Globe2 v-if="activeLinkType === 'url'" :size="22" /><AppWindow v-else :size="22" />{{ activeLinkType === 'url' ? '添加经常访问的网站' : '还没有添加常用应用' }}</div>
    </section>
  </section>
</template>

<style scoped>
.quick-panel { display: grid; gap: 14px; color: var(--color-text); }.quick-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 5px; border-radius: var(--radius-sm); background: var(--color-surface-soft); }.quick-tabs button { min-height: 38px; display: flex; align-items: center; justify-content: center; gap: 6px; border: 0; border-radius: var(--radius-xs); color: var(--color-text-secondary); background: transparent; font-size: var(--font-size-button); cursor: pointer; }.quick-tabs button.active { color: var(--color-quick-actions); background: var(--color-surface); box-shadow: var(--shadow-sm); }.quick-section { display: grid; gap: 11px; }.section-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.section-title h2 { margin: 0 0 3px; font-size: 16px; }.section-title p { margin: 0; color: var(--color-text-muted); font-size: var(--font-size-caption); }.section-title > svg { color: var(--color-quick-actions); }.favorite-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }.favorite-grid button { min-height: 48px; display: flex; align-items: center; gap: 7px; padding: 8px 10px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); color: var(--color-quick-actions); background: color-mix(in srgb, var(--color-quick-actions) 6%, var(--color-surface)); font-size: var(--font-size-body-compact); cursor: pointer; }.favorite-grid span { color: var(--color-text); font-weight: 650; }.compact-empty { min-height: 50px; display: grid; place-items: center; border: 1px dashed var(--color-border); border-radius: var(--radius-sm); color: var(--color-text-muted); font-size: var(--font-size-body-compact); }.recent-title { margin-top: 5px; }.recent-list { max-height: 210px; display: grid; gap: 6px; overflow-y: auto; }.recent-list button { min-height: 48px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; align-items: center; padding: 7px 10px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); color: var(--color-text); text-align: left; background: var(--color-surface); cursor: pointer; }.recent-list span { font-size: var(--font-size-body-compact); font-weight: 650; }.recent-list small { grid-column: 1; color: var(--color-text-muted); font-size: var(--font-size-caption); }.recent-list svg { grid-column: 2; grid-row: 1 / 3; color: var(--color-text-muted); }.copy-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }.copy-grid button { min-height: 92px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 2px 9px; padding: 11px 12px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); color: var(--color-text); text-align: left; background: linear-gradient(145deg, color-mix(in srgb, var(--color-quick-actions) 7%, var(--color-surface)), var(--color-surface)); cursor: pointer; }.copy-grid button > span { width: 36px; height: 36px; grid-row: 1 / 3; display: grid; place-items: center; border-radius: var(--radius-xs); color: var(--color-quick-actions); background: color-mix(in srgb, var(--color-quick-actions) 11%, transparent); }.copy-grid strong { font-size: var(--font-size-body); }.copy-grid small { color: var(--color-text-muted); font-size: var(--font-size-caption); }.copy-grid button > svg { grid-column: 3; grid-row: 1 / 3; color: var(--color-text-muted); }.add-app, .url-form button { min-height: 32px; display: flex; align-items: center; gap: 5px; padding: 5px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-pill); color: var(--color-text-secondary); background: var(--color-surface); font-size: var(--font-size-button); cursor: pointer; }.url-form { display: grid; grid-template-columns: 110px minmax(0, 1fr) 38px auto; gap: 7px; }.url-form input { min-width: 0; min-height: 36px; padding: 7px 9px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); color: var(--color-text); background: var(--color-surface-soft); font-size: var(--font-size-body-compact); }.url-form input[type='color'] { padding: 4px; }.url-form small { grid-column: 1 / -1; color: #d4695f; font-size: var(--font-size-caption); }.link-list { max-height: 275px; display: grid; gap: 7px; overflow-y: auto; }.link-list article { display: grid; grid-template-columns: minmax(0, 1fr) repeat(3, 29px); align-items: center; gap: 4px; padding: 6px 7px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); }.link-main { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 9px; padding: 0; border: 0; color: inherit; text-align: left; background: transparent; cursor: pointer; }.link-main > span:last-child { min-width: 0; display: grid; gap: 2px; }.link-main strong, .link-main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.link-main strong { font-size: var(--font-size-body-compact); }.link-main small { color: var(--color-text-muted); font-size: var(--font-size-caption); }.link-icon { width: 34px; height: 34px; display: grid; place-items: center; border-radius: var(--radius-xs); color: var(--link-accent); background: color-mix(in srgb, var(--link-accent) 12%, transparent); }.link-list article > button:not(.link-main) { width: 29px; height: 29px; display: grid; place-items: center; border: 0; border-radius: 50%; color: var(--color-text-muted); background: transparent; cursor: pointer; }.link-list article > button:not(.link-main):hover { color: var(--color-quick-actions); background: var(--color-surface-hover); }.link-list article.invalid { opacity: .6; }.link-empty { min-height: 120px; align-content: center; gap: 5px; }
.url-form.editing { grid-template-columns: 110px minmax(0, 1fr) 38px auto 32px; }.url-form .cancel-edit { width: 32px; justify-content: center; padding: 0; }.link-list article { grid-template-columns: minmax(0, 1fr) repeat(4, 29px); }.link-list article.editing { border-color: color-mix(in srgb, var(--color-quick-actions) 55%, var(--color-border)); background: color-mix(in srgb, var(--color-quick-actions) 5%, transparent); }.action-spacer { width: 29px; }
.link-type-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 4px; border-radius: var(--radius-xs); background: var(--color-surface-soft); }.link-type-tabs button { min-height: 32px; display: flex; align-items: center; justify-content: center; gap: 5px; border: 0; border-radius: 7px; color: var(--color-text-muted); background: transparent; font-size: var(--font-size-button); cursor: pointer; }.link-type-tabs button.active { color: var(--color-quick-actions); background: var(--color-surface); box-shadow: var(--shadow-sm); }.application-add { min-height: 42px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 8px 5px 11px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-xs); color: var(--color-text-secondary); font-size: var(--font-size-body-compact); }.links-section .link-list { max-height: 220px; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }@media (max-width: 520px) { .quick-tabs { grid-template-columns: 1fr; }.favorite-grid, .copy-grid { grid-template-columns: 1fr; }.url-form, .url-form.editing { grid-template-columns: 1fr auto; }.url-form input:first-child { grid-column: 1 / -1; } }
</style>
