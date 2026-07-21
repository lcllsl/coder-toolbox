<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ArrowDown, ArrowUp, CalendarPlus, Check, Clock3, Copy, Download, File, FileInput, Folder, FolderOpen, HardDrive, Pin, PinOff, Plus, RefreshCw, Trash2, Upload } from '@lucide/vue'

import { useFeedbackStore } from '@/app/stores/feedback'
import { useFilesStore } from '@/app/stores/files'
import { buildDateFolderName, fileNameFromPath, formatFileSize, parentPath, unixToWindowsPath, windowsToUnixPath } from '@/features/files/core/paths'
import type { DateFolderFormat, FavoriteFolder } from '@/features/files/types'
import { writeClipboardText } from '@/services/tauri/clipboard'
import { createDateDirectory, onFileSystemDrop, selectDirectory, selectFiles } from '@/services/tauri/files'

type FilesView = 'folders' | 'paths' | 'date' | 'transfer'
type PathDirection = 'windows-unix' | 'unix-windows'

const files = useFilesStore()
const feedback = useFeedbackStore()
const activeView = ref<FilesView>('folders')
const pathDirection = ref<PathDirection>('windows-unix')
const pathInput = ref('')
const pathOutput = ref('')
const pathError = ref('')
const useWsl = ref(false)
const dateParent = ref('')
const dateFormat = ref<DateFolderFormat>('YYYY-MM-DD')
const dateTopic = ref('')
const creating = ref(false)
const droppedPath = ref('')
let unlistenFileDrop: (() => void) | undefined

const tabs: { id: FilesView; label: string; icon: typeof Folder }[] = [
  { id: 'folders', label: '常用位置', icon: FolderOpen },
  { id: 'paths', label: '路径转换', icon: FileInput },
  { id: 'date', label: '日期文件夹', icon: CalendarPlus },
  { id: 'transfer', label: '临时中转', icon: HardDrive },
]

const dateFolderPreview = computed(() => buildDateFolderName(dateFormat.value, dateTopic.value))

function folderIcon(folder: FavoriteFolder) {
  return folder.id === 'system-downloads' ? Download : folder.system ? FolderOpen : Folder
}

async function addFolder() {
  const path = await selectDirectory('添加常用文件夹')
  if (!path) return
  const added = await files.addFolder(path)
  feedback.notify(added ? '常用文件夹已添加' : '该文件夹已经在列表中', added ? 'success' : 'neutral')
}

async function openFolder(folder: FavoriteFolder) {
  try { await files.openFolder(folder) }
  catch { feedback.notify('文件夹不存在或无法打开', 'warning') }
}

async function copyValue(value: string, label: string) {
  if (!value) return
  try { await writeClipboardText(value); feedback.notify(`${label}已复制`, 'success') }
  catch { feedback.notify('复制失败，请稍后重试', 'warning') }
}

function convertPath() {
  const result = pathDirection.value === 'windows-unix'
    ? windowsToUnixPath(pathInput.value, useWsl.value)
    : unixToWindowsPath(pathInput.value)
  pathOutput.value = result.value ?? ''
  pathError.value = result.error ?? ''
}

function swapDirection() {
  pathDirection.value = pathDirection.value === 'windows-unix' ? 'unix-windows' : 'windows-unix'
  pathInput.value = pathOutput.value
  pathOutput.value = ''
  pathError.value = ''
}

async function chooseDateParent() {
  const selected = await selectDirectory('选择日期文件夹的父目录')
  if (selected) dateParent.value = selected
}

async function createFolder() {
  if (!dateParent.value) { feedback.notify('请先选择父目录', 'warning'); return }
  if (!dateFolderPreview.value.value) { feedback.notify(dateFolderPreview.value.error ?? '文件夹名称无效', 'warning'); return }
  creating.value = true
  try {
    const result = await createDateDirectory(dateParent.value, dateFolderPreview.value.value)
    feedback.notify(result.existed ? '文件夹已存在，已直接打开' : '日期文件夹已创建并打开', result.existed ? 'neutral' : 'success')
  } catch { feedback.notify('创建失败，请检查父目录权限', 'warning') }
  finally { creating.value = false }
}

async function addTransferPaths(paths: string[]) {
  const result = await files.addTransferPaths(paths)
  if (result.added) feedback.notify(`已复制 ${result.added} 项到临时中转`, 'success')
  if (result.failed) feedback.notify(`${result.failed} 项复制失败或包含不支持的链接`, 'warning')
}

async function chooseTransferFiles() {
  await addTransferPaths(await selectFiles('选择要中转的文件'))
}

async function chooseTransferFolder() {
  const selected = await selectDirectory('选择要中转的文件夹')
  if (selected) await addTransferPaths([selected])
}

async function deleteTransfer(id: string) {
  const item = files.transferItems.find((value) => value.id === id)
  if (!item) return
  try { await files.deleteTransfer(item); feedback.notify('中转副本已删除，原文件未受影响', 'success') }
  catch { feedback.notify('删除失败，请稍后重试', 'warning') }
}

async function openTransfer(id: string) {
  const item = files.transferItems.find((value) => value.id === id)
  if (!item) return
  try { await files.openTransfer(item) }
  catch { feedback.notify('中转副本不存在或无法打开', 'warning') }
}

function formatTransferDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

async function handleFileDrop(paths: string[]) {
  if (activeView.value === 'transfer') {
    await addTransferPaths(paths)
    return
  }
  if (activeView.value === 'paths' && paths[0]) {
    droppedPath.value = paths[0]
    await copyValue(paths[0], '完整路径')
  }
}

onMounted(async () => {
  await files.initialize()
  dateParent.value = files.systemFolders.find((folder) => folder.id === 'system-downloads')?.path ?? ''
  unlistenFileDrop = await onFileSystemDrop((paths) => void handleFileDrop(paths))
})

onUnmounted(() => unlistenFileDrop?.())
</script>

<template>
  <section class="files-panel">
    <nav class="files-tabs" aria-label="文件与路径工具">
      <button v-for="tab in tabs" :key="tab.id" type="button" :class="{ active: activeView === tab.id }" @click="activeView = tab.id">
        <component :is="tab.icon" :size="16" />{{ tab.label }}
      </button>
    </nav>

    <section v-if="activeView === 'folders'" class="tool-section folder-section">
      <header class="section-heading">
        <div><h2>常用文件夹</h2><p>打开前自动检查路径，失效目录不会静默失败。</p></div>
        <div class="heading-actions"><button type="button" title="刷新状态" aria-label="刷新文件夹状态" @click="files.refreshStatuses"><RefreshCw :size="15" /></button><button class="primary" type="button" @click="addFolder"><Plus :size="15" />添加文件夹</button></div>
      </header>

      <div class="folder-grid system-folders">
        <button v-for="folder in files.systemFolders" :key="folder.id" class="system-folder" type="button" :class="{ invalid: !folder.exists }" @click="openFolder(folder)">
          <component :is="folderIcon(folder)" :size="20" /><span><strong>{{ folder.name }}</strong><small>{{ folder.path }}</small></span><FolderOpen :size="15" />
        </button>
      </div>

      <div v-if="files.customFolders.length" class="custom-folders">
        <article v-for="(folder, index) in files.customFolders" :key="folder.id" class="folder-row" :class="{ invalid: !folder.exists }">
          <span class="folder-mark"><Folder :size="18" /></span>
          <div><input :value="folder.name" aria-label="文件夹名称" @change="files.renameFolder(folder.id, ($event.target as HTMLInputElement).value)" /><small>{{ folder.path }}</small><em v-if="!folder.exists">路径已失效</em></div>
          <button type="button" aria-label="打开文件夹" title="打开" :disabled="!folder.exists" @click="openFolder(folder)"><FolderOpen :size="15" /></button>
          <button type="button" aria-label="上移文件夹" title="上移" :disabled="index === 0" @click="files.moveFolder(folder.id, -1)"><ArrowUp :size="14" /></button>
          <button type="button" aria-label="下移文件夹" title="下移" :disabled="index === files.customFolders.length - 1" @click="files.moveFolder(folder.id, 1)"><ArrowDown :size="14" /></button>
          <button type="button" aria-label="删除常用文件夹" title="删除" @click="files.removeFolder(folder.id)"><Trash2 :size="14" /></button>
        </article>
      </div>
      <div v-else class="inline-empty"><Folder :size="22" /><span>还没有自定义目录，可添加项目或资料文件夹。</span></div>
    </section>

    <section v-else-if="activeView === 'paths'" class="tool-section path-section">
      <header class="section-heading"><div><h2>路径格式转换</h2><p>转换只改变显示格式，不访问文件系统。</p></div><button type="button" @click="swapDirection">切换方向</button></header>
      <div class="path-options">
        <label><input v-model="pathDirection" type="radio" value="windows-unix" />Windows → Unix</label>
        <label><input v-model="pathDirection" type="radio" value="unix-windows" />WSL → Windows</label>
        <label v-if="pathDirection === 'windows-unix'" class="wsl-option"><input v-model="useWsl" type="checkbox" />转换为 WSL `/mnt` 风格</label>
      </div>
      <label class="path-field"><span>原始路径</span><textarea v-model="pathInput" aria-label="原始路径" spellcheck="false" placeholder="例如 C:\Users\demo\file.txt" @keydown.meta.enter.prevent="convertPath" @keydown.ctrl.enter.prevent="convertPath" /></label>
      <div class="path-command"><button class="primary" type="button" @click="convertPath">转换路径</button><span v-if="pathError" role="alert">{{ pathError }}</span></div>
      <label class="path-field"><span>转换结果</span><textarea :value="pathOutput" aria-label="路径转换结果" readonly spellcheck="false" /></label>
      <button class="copy-result" type="button" :disabled="!pathOutput" @click="copyValue(pathOutput, '路径')"><Copy :size="15" />复制结果</button>
      <div class="path-drop-zone">
        <Upload :size="20" />
        <div v-if="droppedPath"><strong>{{ fileNameFromPath(droppedPath) }}</strong><small :title="droppedPath">{{ droppedPath }}</small></div>
        <div v-else><strong>拖入文件或文件夹</strong><small>拖入后立即复制完整路径，并可选择复制名称或父目录。</small></div>
        <div v-if="droppedPath" class="drop-copy-actions"><button type="button" @click="copyValue(droppedPath, '完整路径')">完整路径</button><button type="button" @click="copyValue(fileNameFromPath(droppedPath), '文件名')">文件名</button><button type="button" @click="copyValue(parentPath(droppedPath), '父目录')">父目录</button></div>
      </div>
    </section>

    <section v-else-if="activeView === 'date'" class="tool-section date-section">
      <header class="section-heading"><div><h2>创建日期文件夹</h2><p>不会覆盖同名目录，创建后自动在文件管理器中打开。</p></div></header>
      <label class="parent-picker"><span>父目录</span><div><input :value="dateParent" aria-label="日期文件夹父目录" readonly placeholder="请选择父目录" /><button type="button" @click="chooseDateParent"><FolderOpen :size="15" />选择</button></div></label>
      <fieldset><legend>命名格式</legend><label><input v-model="dateFormat" type="radio" value="YYYY-MM-DD" />YYYY-MM-DD</label><label><input v-model="dateFormat" type="radio" value="YYYYMMDD" />YYYYMMDD</label><label><input v-model="dateFormat" type="radio" value="YYYY-MM-DD_topic" />日期 + 主题</label></fieldset>
      <label v-if="dateFormat === 'YYYY-MM-DD_topic'" class="topic-field"><span>主题</span><input v-model="dateTopic" aria-label="日期文件夹主题" placeholder="例如：设计稿" /></label>
      <div class="folder-preview" :class="{ error: dateFolderPreview.error }"><CalendarPlus :size="20" /><span><small>将创建</small><strong>{{ dateFolderPreview.value ?? dateFolderPreview.error }}</strong></span><Check v-if="dateFolderPreview.value" :size="17" /></div>
      <button class="create-button primary" type="button" :disabled="creating || !dateFolderPreview.value" @click="createFolder"><CalendarPlus :size="16" />{{ creating ? '正在创建…' : '创建并打开' }}</button>
    </section>

    <section v-else class="tool-section transfer-section">
      <header class="section-heading"><div><h2>临时文件中转</h2><p>复制到应用临时区，源文件不会被移动或删除。</p></div><div class="heading-actions"><button type="button" @click="chooseTransferFolder"><Folder :size="15" />文件夹</button><button class="primary" type="button" @click="chooseTransferFiles"><Plus :size="15" />添加文件</button></div></header>
      <div class="transfer-drop-zone" :class="{ busy: files.transferring }">
        <Upload :size="25" /><strong>{{ files.transferring ? '正在复制，请稍候…' : '将文件或文件夹拖到这里' }}</strong><small>副本默认保留 7 天；固定后不会自动清理。</small>
      </div>
      <div v-if="files.transferItems.length" class="transfer-list">
        <article v-for="item in files.transferItems" :key="item.id" class="transfer-row">
          <span class="transfer-icon"><Folder v-if="item.kind === 'directory'" :size="19" /><File v-else :size="19" /></span>
          <button class="transfer-info" type="button" :title="`打开中转副本：${item.storedPath}`" @click="openTransfer(item.id)"><strong>{{ item.name }}</strong><small :title="item.originalPath">来源：{{ item.originalPath }}</small><em><span>{{ formatFileSize(item.sizeBytes) }}</span><span>添加于 {{ formatTransferDate(item.addedAt) }}</span><span v-if="item.isPinned"><Pin :size="11" />已固定</span><span v-else><Clock3 :size="11" />{{ formatTransferDate(item.expiresAt) }} 清理</span></em></button>
          <button type="button" :aria-label="item.isPinned ? '取消固定' : '固定中转项'" :title="item.isPinned ? '取消固定' : '固定'" @click="files.toggleTransferPinned(item)"><PinOff v-if="item.isPinned" :size="15" /><Pin v-else :size="15" /></button>
          <button type="button" aria-label="删除中转副本" title="仅删除中转副本" @click="deleteTransfer(item.id)"><Trash2 :size="15" /></button>
        </article>
      </div>
      <div v-else class="transfer-empty"><HardDrive :size="22" /><span>还没有中转内容</span></div>
    </section>
  </section>
</template>

<style scoped>
.files-panel { display: grid; gap: 14px; color: var(--color-text); }
.files-tabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; padding: 5px; border-radius: var(--radius-sm); background: var(--color-surface-soft); }
.files-tabs button { min-height: 38px; display: flex; align-items: center; justify-content: center; gap: 6px; border: 0; border-radius: var(--radius-xs); color: var(--color-text-secondary); background: transparent; font-size: var(--font-size-button); cursor: pointer; }.files-tabs button.active { color: var(--color-files); background: var(--color-surface); box-shadow: var(--shadow-sm); }
.tool-section { display: grid; gap: 13px; }.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }.section-heading h2 { margin: 0 0 3px; font-size: 16px; }.section-heading p { margin: 0; color: var(--color-text-muted); font-size: var(--font-size-caption); }.section-heading button, .heading-actions button, .copy-result { min-height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 5px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-pill); color: var(--color-text-secondary); background: var(--color-surface); font-size: var(--font-size-button); cursor: pointer; }.heading-actions { display: flex; gap: 6px; }.folder-section .heading-actions button:first-child { width: 32px; padding: 0; }
.primary { border-color: transparent !important; color: var(--color-on-accent) !important; background: var(--color-files) !important; }
.folder-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }.system-folder { min-width: 0; min-height: 66px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 9px 10px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); color: var(--color-files); text-align: left; background: var(--color-surface-soft); cursor: pointer; }.system-folder span { min-width: 0; display: grid; gap: 2px; }.system-folder strong { color: var(--color-text); font-size: var(--font-size-body-compact); }.system-folder small, .folder-row small { overflow: hidden; color: var(--color-text-muted); font-size: var(--font-size-caption); text-overflow: ellipsis; white-space: nowrap; }
.custom-folders { max-height: 242px; display: grid; gap: 7px; overflow-y: auto; }.folder-row { display: grid; grid-template-columns: auto minmax(0, 1fr) repeat(4, 29px); align-items: center; gap: 6px; padding: 7px 8px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface); }.folder-mark { width: 32px; height: 32px; display: grid; place-items: center; border-radius: var(--radius-xs); color: var(--color-files); background: color-mix(in srgb, var(--color-files) 10%, transparent); }.folder-row > div { min-width: 0; display: grid; gap: 2px; }.folder-row input { min-width: 0; padding: 0; border: 0; outline: 0; color: var(--color-text); background: transparent; font-size: var(--font-size-body-compact); font-weight: 650; }.folder-row button { width: 29px; height: 29px; display: grid; place-items: center; border: 0; border-radius: 50%; color: var(--color-text-muted); background: transparent; cursor: pointer; }.folder-row button:hover { color: var(--color-files); background: var(--color-surface-hover); }.folder-row em { color: #d4695f; font-size: 11px; font-style: normal; }.invalid { opacity: .58; }
.inline-empty { min-height: 92px; display: grid; place-items: center; align-content: center; gap: 5px; border: 1px dashed var(--color-border); border-radius: var(--radius-sm); color: var(--color-text-muted); font-size: var(--font-size-body-compact); }
.path-options { display: flex; align-items: center; gap: 16px; min-height: 34px; color: var(--color-text-secondary); font-size: var(--font-size-body-compact); }.path-options label { display: flex; align-items: center; gap: 5px; }.path-options input { accent-color: var(--color-files); }.wsl-option { margin-left: auto; }
.path-field { display: grid; gap: 5px; }.path-field > span, .parent-picker > span, .topic-field > span { color: var(--color-text-secondary); font-size: var(--font-size-body-compact); font-weight: 650; }.path-field textarea { min-height: 94px; resize: none; padding: 10px 11px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); outline: 0; color: var(--color-text); background: var(--color-surface-soft); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: var(--font-size-body); line-height: 1.5; user-select: text; }.path-field textarea:focus { border-color: var(--color-focus); }.path-command { display: flex; align-items: center; gap: 10px; }.path-command button, .create-button { min-height: 34px; display: inline-flex; align-items: center; justify-content: center; padding: 6px 14px; border: 0; border-radius: var(--radius-pill); font-size: var(--font-size-button); cursor: pointer; }.path-command span { color: #d4695f; font-size: var(--font-size-caption); }.copy-result { justify-self: end; }
.parent-picker, .topic-field { display: grid; gap: 6px; }.parent-picker > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; }.parent-picker input, .topic-field input { min-height: 38px; padding: 8px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); color: var(--color-text); background: var(--color-surface-soft); font-size: var(--font-size-body); }.parent-picker button { display: flex; align-items: center; gap: 5px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); color: var(--color-text-secondary); background: var(--color-surface); cursor: pointer; }
fieldset { display: flex; gap: 16px; margin: 0; padding: 10px 12px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); }fieldset legend { padding: 0 5px; color: var(--color-text-secondary); font-size: var(--font-size-caption); }fieldset label { display: flex; align-items: center; gap: 5px; font-size: var(--font-size-body-compact); }fieldset input { accent-color: var(--color-files); }.folder-preview { min-height: 68px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 11px 13px; border-radius: var(--radius-sm); color: var(--color-files); background: color-mix(in srgb, var(--color-files) 9%, var(--color-surface)); }.folder-preview span { display: grid; gap: 2px; }.folder-preview small { color: var(--color-text-muted); font-size: var(--font-size-caption); }.folder-preview strong { overflow: hidden; color: var(--color-text); font-size: var(--font-size-body); text-overflow: ellipsis; white-space: nowrap; }.folder-preview.error strong { color: #d4695f; }.create-button { justify-self: end; }
.path-drop-zone { min-height: 68px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 10px 12px; border: 1px dashed color-mix(in srgb, var(--color-files) 45%, var(--color-border)); border-radius: var(--radius-sm); color: var(--color-files); background: color-mix(in srgb, var(--color-files) 5%, transparent); }.path-drop-zone > div { min-width: 0; display: grid; gap: 2px; }.path-drop-zone strong { color: var(--color-text); font-size: var(--font-size-body-compact); }.path-drop-zone small { overflow: hidden; color: var(--color-text-muted); font-size: var(--font-size-caption); text-overflow: ellipsis; white-space: nowrap; }.drop-copy-actions { display: flex !important; grid-auto-flow: column; gap: 5px !important; }.drop-copy-actions button { padding: 5px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-pill); color: var(--color-text-secondary); background: var(--color-surface); font-size: var(--font-size-button); cursor: pointer; }
.transfer-section { min-height: 390px; }.transfer-drop-zone { min-height: 88px; display: grid; place-items: center; align-content: center; gap: 3px; border: 1px dashed color-mix(in srgb, var(--color-files) 50%, var(--color-border)); border-radius: var(--radius-sm); color: var(--color-files); background: color-mix(in srgb, var(--color-files) 6%, transparent); transition: opacity 160ms ease, transform 160ms ease; }.transfer-drop-zone strong { color: var(--color-text); font-size: var(--font-size-body); }.transfer-drop-zone small { color: var(--color-text-muted); font-size: var(--font-size-caption); }.transfer-drop-zone.busy { opacity: .65; transform: scale(.99); }.transfer-list { max-height: 315px; display: grid; gap: 7px; overflow-y: auto; }.transfer-row { display: grid; grid-template-columns: auto minmax(0, 1fr) 31px 31px; align-items: center; gap: 7px; padding: 8px 9px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface); }.transfer-icon { width: 36px; height: 36px; display: grid; place-items: center; border-radius: var(--radius-xs); color: var(--color-files); background: color-mix(in srgb, var(--color-files) 10%, transparent); }.transfer-info { min-width: 0; display: grid; gap: 2px; padding: 0; border: 0; color: inherit; text-align: left; background: transparent; cursor: pointer; }.transfer-info strong, .transfer-info small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.transfer-info strong { font-size: var(--font-size-body-compact); }.transfer-info small { color: var(--color-text-muted); font-size: var(--font-size-caption); }.transfer-info em { display: flex; flex-wrap: wrap; gap: 8px; color: var(--color-text-secondary); font-size: 11px; font-style: normal; }.transfer-info em span { display: inline-flex; align-items: center; gap: 3px; }.transfer-row > button:not(.transfer-info) { width: 31px; height: 31px; display: grid; place-items: center; border: 0; border-radius: 50%; color: var(--color-text-muted); background: transparent; cursor: pointer; }.transfer-row > button:not(.transfer-info):hover { color: var(--color-files); background: var(--color-surface-hover); }.transfer-empty { min-height: 118px; display: grid; place-items: center; align-content: center; gap: 5px; color: var(--color-text-muted); font-size: var(--font-size-body-compact); }
button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
@media (max-width: 540px) { .files-tabs { grid-template-columns: repeat(2, 1fr); }.folder-grid { grid-template-columns: 1fr; }.path-options { align-items: flex-start; flex-direction: column; gap: 7px; }.wsl-option { margin-left: 0; }.path-drop-zone { grid-template-columns: auto minmax(0, 1fr); }.drop-copy-actions { grid-column: 1 / -1; } }
@media (prefers-reduced-motion: reduce) { .transfer-drop-zone { transition: none; } }
</style>
