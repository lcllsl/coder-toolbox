<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ClipboardCopy, Clock3, Code2, Copy, FileText, Heart, Image as ImageIcon, Link, Pause, Pin, Play, Search, ShieldAlert, Trash2 } from '@lucide/vue'

import { useClipboardStore } from '@/app/stores/clipboard'
import { useFeedbackStore } from '@/app/stores/feedback'
import UiConfirmDialog from '@/components/ui/UiConfirmDialog.vue'
import ClipboardImagePreview from './ClipboardImagePreview.vue'
import ClipboardImageDialog from './ClipboardImageDialog.vue'
import type { ClipboardContentType, ClipboardItem } from '../types'

const clipboard = useClipboardStore()
const feedback = useFeedbackStore()
const confirmAction = ref<'selected' | 'unprotected' | 'disable-sensitive'>()
const previewItem = ref<ClipboardItem>()

const filters: { value: ClipboardContentType | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'plain_text', label: '文本' },
  { value: 'url', label: '链接' },
  { value: 'json', label: 'JSON' },
  { value: 'code', label: '代码' },
  { value: 'image', label: '图片' },
  { value: 'color', label: '颜色' },
  { value: 'email', label: '邮箱' },
]

const groupedItems = computed(() => {
  const groups = new Map<string, ClipboardItem[]>()
  for (const item of clipboard.items) {
    const date = new Date(item.updatedAt)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const key = date.toDateString() === today.toDateString()
      ? '今天'
      : date.toDateString() === yesterday.toDateString()
        ? '昨天'
        : new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.entries()]
})

function typeLabel(type: ClipboardContentType) {
  return { plain_text: '文本', url: '链接', json: 'JSON', code: '代码', image: '图片', color: '颜色', email: '邮箱', unknown: '其他' }[type]
}

function itemIcon(type: ClipboardContentType) {
  if (type === 'image') return ImageIcon
  if (type === 'url') return Link
  if (type === 'code' || type === 'json') return Code2
  return FileText
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

async function copyItem(item: ClipboardItem) {
  try {
    await clipboard.copyItem(item)
    feedback.notify('已复制到剪贴板', 'success')
  } catch {
    feedback.notify('复制失败，请稍后重试', 'warning')
  }
}

function activateCard(item: ClipboardItem) {
  if (item.type === 'image' && item.imagePath) {
    previewItem.value = item
    return
  }
  void copyItem(item)
}

async function togglePaused() {
  await clipboard.setPaused(!clipboard.settings.paused)
  feedback.notify(clipboard.settings.paused ? '已暂停记录剪贴板' : '已恢复记录剪贴板')
}

async function confirmDelete() {
  const action = confirmAction.value
  confirmAction.value = undefined
  try {
    if (action === 'selected') await clipboard.deleteSelected()
    else if (action === 'unprotected') await clipboard.clearUnprotected()
    else if (action === 'disable-sensitive') {
      await clipboard.setSkipSensitive(false)
      feedback.notify('敏感内容保护已关闭', 'warning')
      return
    }
    feedback.notify('剪贴板记录已清理', 'success')
  } catch {
    feedback.notify(action === 'disable-sensitive' ? '关闭失败，敏感内容保护仍然开启' : '清理失败，请稍后重试', 'warning')
  }
}

async function changeSensitiveProtection(enabled: boolean) {
  if (!enabled) {
    confirmAction.value = 'disable-sensitive'
    return
  }
  await clipboard.setSkipSensitive(true)
}

onMounted(() => void clipboard.initialize())
</script>

<template>
  <section class="clipboard-panel">
    <div class="clipboard-toolbar">
      <label class="search-box">
        <Search :size="17" aria-hidden="true" />
        <input type="search" aria-label="搜索剪贴板" placeholder="搜索复制内容" :value="clipboard.query.search" @input="clipboard.setSearch(($event.target as HTMLInputElement).value)" />
      </label>
      <button class="pause-button" :class="{ active: clipboard.settings.paused }" type="button" @click="togglePaused">
        <Play v-if="clipboard.settings.paused" :size="15" />
        <Pause v-else :size="15" />
        {{ clipboard.settings.paused ? '恢复记录' : '暂停记录' }}
      </button>
    </div>

    <div class="filter-row" aria-label="剪贴板类型筛选">
      <button v-for="filter in filters" :key="filter.value" type="button" :class="{ active: clipboard.query.type === filter.value }" @click="clipboard.setType(filter.value)">{{ filter.label }}</button>
      <button type="button" :class="{ active: clipboard.query.favoritesOnly }" @click="clipboard.setFavoritesOnly(!clipboard.query.favoritesOnly)"><Heart :size="13" />收藏</button>
    </div>

    <div v-if="clipboard.lastSkippedAt" class="sensitive-notice" role="status">
      <ShieldAlert :size="17" />
      <span>刚刚跳过了一条疑似敏感内容，未保存正文。</span>
      <button type="button" @click="clipboard.lastSkippedAt = undefined">知道了</button>
    </div>
    <div v-else-if="clipboard.settings.paused" class="paused-notice" role="status"><Pause :size="16" />记录已暂停，复制内容不会进入历史。</div>

    <div v-if="clipboard.selectedCount" class="batch-bar">
      <strong>已选择 {{ clipboard.selectedCount }} 项</strong>
      <button type="button" @click="clipboard.clearSelection">取消选择</button>
      <button class="danger" type="button" @click="confirmAction = 'selected'"><Trash2 :size="14" />删除</button>
    </div>

    <div v-if="groupedItems.length" class="clipboard-groups">
      <section v-for="[date, items] in groupedItems" :key="date" class="date-group">
        <header><span>{{ date }}</span><small>{{ items.length }} 项</small></header>
        <div class="card-grid">
          <article v-for="item in items" :key="item.id" class="clipboard-card" :class="{ pinned: item.isPinned, selected: clipboard.selectedIds.includes(item.id) }">
            <button class="card-body" type="button" :aria-label="item.type === 'image' ? '预览剪贴板图片' : `复制${typeLabel(item.type)}内容`" @click="activateCard(item)">
              <span class="type-mark"><component :is="itemIcon(item.type)" :size="16" />{{ typeLabel(item.type) }}</span>
              <ClipboardImagePreview v-if="item.type === 'image' && item.imagePath" :path="item.imagePath" :alt="`剪贴板图片，${item.previewText}`" />
              <pre v-else>{{ item.previewText || '暂无预览' }}</pre>
              <span v-if="item.type === 'color'" class="color-preview" :style="{ background: item.textContent }" />
            </button>
            <footer>
              <label class="select-item"><input type="checkbox" :checked="clipboard.selectedIds.includes(item.id)" :aria-label="`选择${typeLabel(item.type)}记录`" @change="clipboard.toggleSelected(item.id)" /></label>
              <span><Clock3 :size="12" />{{ formatTime(item.updatedAt) }}</span>
              <span v-if="item.copyCount > 1">{{ item.copyCount }} 次</span>
              <div class="card-actions">
                <button type="button" :aria-label="`复制${typeLabel(item.type)}内容`" title="复制" @click="copyItem(item)"><Copy :size="14" /></button>
                <button type="button" :class="{ active: item.isFavorite }" :aria-pressed="item.isFavorite" aria-label="收藏" title="收藏" @click="clipboard.toggleFavorite(item)"><Heart :size="14" :fill="item.isFavorite ? 'currentColor' : 'none'" /></button>
                <button type="button" :class="{ active: item.isPinned }" :aria-pressed="item.isPinned" aria-label="固定" title="固定" @click="clipboard.togglePinned(item)"><Pin :size="14" :fill="item.isPinned ? 'currentColor' : 'none'" /></button>
                <button type="button" aria-label="删除" title="删除" @click="clipboard.deleteOne(item.id)"><Trash2 :size="14" /></button>
              </div>
            </footer>
          </article>
        </div>
      </section>
    </div>

    <div v-else class="empty-state">
      <span><ClipboardCopy :size="28" /></span>
      <h2>{{ clipboard.initialized ? '还没有匹配的记录' : '正在读取剪贴板' }}</h2>
      <p>复制文本，或完成一次截图并点击确认，内容会自动出现在这里。</p>
    </div>

    <footer class="clipboard-policy">
      <label><input type="checkbox" :checked="clipboard.settings.skipSensitive" @change="changeSensitiveProtection(($event.target as HTMLInputElement).checked)" /><span><strong>自动跳过敏感内容 <em :class="{ warning: !clipboard.settings.skipSensitive }">{{ clipboard.settings.skipSensitive ? '保护已开启' : '保护已关闭' }}</em></strong><small>本地检测疑似密码、验证码、私钥、令牌和银行卡号</small></span></label>
      <button type="button" @click="confirmAction = 'unprotected'">清空非收藏记录</button>
    </footer>

    <UiConfirmDialog
      :open="Boolean(confirmAction)"
      :title="confirmAction === 'disable-sensitive' ? '关闭敏感内容保护？' : '删除剪贴板记录？'"
      :message="confirmAction === 'disable-sensitive' ? '关闭后，疑似密码、验证码、私钥、访问令牌和银行卡号也可能被保存到本地历史。' : confirmAction === 'selected' ? `将删除选中的 ${clipboard.selectedCount} 项记录。` : '将删除所有未收藏且未固定的记录，此操作无法撤销。'"
      :confirm-label="confirmAction === 'disable-sensitive' ? '仍然关闭' : '删除'"
      @cancel="confirmAction = undefined"
      @confirm="confirmDelete"
    />
    <ClipboardImageDialog :item="previewItem" @close="previewItem = undefined" />
  </section>
</template>

<style scoped>
.clipboard-panel { display: grid; gap: 12px; color: var(--color-text); }
.clipboard-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; }
.search-box { min-height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text-muted); background: var(--color-surface-soft); }
.search-box:focus-within { border-color: var(--color-focus); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-focus) 15%, transparent); }
.search-box input { width: 100%; border: 0; outline: 0; color: var(--color-text); background: transparent; font: inherit; font-size: var(--font-size-body); }
.pause-button, .filter-row button, .batch-bar button, .clipboard-policy > button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--color-border); color: var(--color-text-secondary); background: var(--color-surface); cursor: pointer; }
.pause-button { min-width: 100px; border-radius: var(--radius-sm); font-size: var(--font-size-button); }
.pause-button.active { color: var(--color-clipboard); border-color: color-mix(in srgb, var(--color-clipboard) 42%, transparent); background: color-mix(in srgb, var(--color-clipboard) 9%, transparent); }
.filter-row { display: flex; align-items: center; gap: 5px; overflow-x: auto; padding-bottom: 2px; }
.filter-row button { flex: 0 0 auto; padding: 5px 9px; border-color: transparent; border-radius: var(--radius-pill); font-size: var(--font-size-button); }
.filter-row button.active { color: var(--color-clipboard); border-color: color-mix(in srgb, var(--color-clipboard) 25%, transparent); background: color-mix(in srgb, var(--color-clipboard) 10%, transparent); }
.sensitive-notice, .paused-notice { min-height: 38px; display: flex; align-items: center; gap: 8px; padding: 8px 11px; border-radius: var(--radius-sm); color: #9a6824; background: color-mix(in srgb, #e4a13a 13%, var(--color-surface)); font-size: var(--font-size-body-compact); }
.sensitive-notice span { flex: 1; }.sensitive-notice button { border: 0; color: inherit; background: transparent; cursor: pointer; }
.paused-notice { color: var(--color-clipboard); background: color-mix(in srgb, var(--color-clipboard) 10%, var(--color-surface)); }
.batch-bar { display: flex; align-items: center; gap: 7px; min-height: 38px; padding: 7px 10px; border-radius: var(--radius-sm); background: color-mix(in srgb, var(--color-clipboard) 9%, var(--color-surface)); font-size: var(--font-size-button); }
.batch-bar strong { flex: 1; }.batch-bar button { padding: 4px 8px; border-radius: var(--radius-pill); }.batch-bar .danger { color: #d45d61; }
.clipboard-groups { display: grid; gap: 14px; }.date-group { display: grid; gap: 8px; }.date-group > header { display: flex; align-items: center; gap: 8px; color: var(--color-text-secondary); font-size: var(--font-size-body-compact); font-weight: 650; }.date-group > header small { color: var(--color-text-muted); font-size: var(--font-size-caption); font-weight: 400; }
.card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.clipboard-card { position: relative; min-width: 0; overflow: hidden; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-soft); transition: border-color var(--duration-fast), transform var(--duration-fast); }
.clipboard-card:hover { border-color: color-mix(in srgb, var(--color-clipboard) 34%, var(--color-border)); transform: translateY(-1px); }.clipboard-card.pinned { border-color: color-mix(in srgb, var(--color-clipboard) 28%, var(--color-border)); }.clipboard-card.selected { box-shadow: inset 0 0 0 1px var(--color-clipboard); }
.card-body { position: relative; width: 100%; min-height: 104px; display: block; padding: 11px 12px 7px; border: 0; color: var(--color-text); text-align: left; background: transparent; cursor: pointer; }
.type-mark { display: flex; align-items: center; gap: 5px; color: var(--color-clipboard); font-size: var(--font-size-caption); font-weight: 650; }
.card-body pre { max-height: 72px; margin: 8px 0 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; color: var(--color-text-secondary); font-family: inherit; font-size: var(--font-size-body); line-height: 1.5; scrollbar-color: color-mix(in srgb, var(--color-clipboard) 32%, transparent) transparent; scrollbar-width: thin; white-space: pre-wrap; word-break: break-word; }
.card-body pre::-webkit-scrollbar { width: 5px; }
.card-body pre::-webkit-scrollbar-track { background: transparent; }
.card-body pre::-webkit-scrollbar-thumb { border-radius: var(--radius-pill); background: color-mix(in srgb, var(--color-clipboard) 28%, transparent); }
.color-preview { position: absolute; top: 10px; right: 11px; width: 19px; height: 19px; border: 2px solid var(--color-surface); border-radius: 50%; box-shadow: 0 0 0 1px var(--color-border); }
.clipboard-card footer { min-height: 34px; display: flex; align-items: center; gap: 7px; padding: 4px 7px 5px 10px; border-top: 1px solid var(--color-border-subtle); color: var(--color-text-muted); font-size: 11px; }.clipboard-card footer > span { display: inline-flex; align-items: center; gap: 3px; }.select-item { display: flex; }.select-item input { accent-color: var(--color-clipboard); }
.card-actions { display: flex; margin-left: auto; opacity: .25; transition: opacity var(--duration-fast); }.clipboard-card:hover .card-actions, .card-actions:focus-within { opacity: 1; }.card-actions button { width: 25px; height: 25px; display: grid; place-items: center; border: 0; border-radius: 50%; color: var(--color-text-muted); background: transparent; cursor: pointer; }.card-actions button:hover, .card-actions button.active { color: var(--color-clipboard); background: var(--color-surface-hover); }
.empty-state { min-height: 280px; display: grid; place-items: center; align-content: center; gap: 7px; color: var(--color-text-muted); text-align: center; }.empty-state > span { width: 54px; height: 54px; display: grid; place-items: center; border-radius: 18px; color: var(--color-clipboard); background: color-mix(in srgb, var(--color-clipboard) 10%, transparent); }.empty-state h2 { margin: 5px 0 0; color: var(--color-text); font-size: 16px; }.empty-state p { margin: 0; font-size: var(--font-size-body); }
.clipboard-policy { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface-soft); }.clipboard-policy label { flex: 1; display: flex; align-items: center; gap: 8px; }.clipboard-policy input { accent-color: var(--color-clipboard); }.clipboard-policy span { display: grid; gap: 2px; }.clipboard-policy strong { font-size: var(--font-size-body-compact); }.clipboard-policy strong em { margin-left: 5px; color: var(--color-health); font-size: 11px; font-style: normal; font-weight: 600; }.clipboard-policy strong em.warning { color: var(--color-dev-tools); }.clipboard-policy small { color: var(--color-text-muted); font-size: var(--font-size-caption); }.clipboard-policy > button { flex: 0 0 auto; padding: 6px 9px; border-radius: var(--radius-pill); font-size: var(--font-size-button); }
button:focus-visible, input:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
@media (max-width: 560px) { .card-grid { grid-template-columns: 1fr; }.clipboard-policy { align-items: flex-start; flex-direction: column; }.clipboard-policy > button { align-self: flex-end; } }
@media (prefers-reduced-motion: reduce) { .clipboard-card { transition-duration: 20ms; } }
</style>
