<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
} from '@lucide/vue'

import { useFeedbackStore } from '@/app/stores/feedback'
import { useSettingsStore } from '@/app/stores/settings'
import { useVaultStore } from '@/app/stores/vault'
import UiConfirmDialog from '@/components/ui/UiConfirmDialog.vue'
import { validateVaultInitialization } from '../core/validation'
import type { VaultCopyReceipt, VaultItem, VaultItemInput } from '../types'
import VaultCredentialDialog from './VaultCredentialDialog.vue'

type ForgotStage = 'first' | 'final'

const vault = useVaultStore()
const settings = useSettingsStore()
const feedback = useFeedbackStore()
const setupPassword = ref('')
const setupConfirmation = ref('')
const setupPasswordsVisible = ref(false)
const unlockPassword = ref('')
const unlockPasswordVisible = ref(false)
const formError = ref('')
const formWarning = ref('')
const busy = ref(false)
const credentialDialogOpen = ref(false)
const editingItem = ref<VaultItem>()
const deleteId = ref<string>()
const forgotStage = ref<ForgotStage>()
const revealedIds = ref(new Set<string>())
const revealTimers = new Map<string, number>()

const deleteTitle = computed(() => vault.items.find((item) => item.id === deleteId.value)?.title ?? '该凭据')
const setupPasswordRisk = computed(() => setupPassword.value && setupPassword.value.length < 8
  ? '当前主密码较短，建议使用更长且不易猜测的密码。'
  : '')
const forgotTitle = computed(() => forgotStage.value === 'final' ? '最后确认删除？' : '忘记主密码？')
const forgotMessage = computed(() => forgotStage.value === 'final'
  ? '此操作将永久删除全部加密凭据和凭据夹元数据，无法恢复。'
  : '主密码不会被保存，也无法找回。你只能删除现有凭据夹并重新初始化。')

function isWrongMasterPassword(error: unknown): boolean {
  const code = error instanceof Error ? error.message : String(error)
  return /(?:invalid|wrong|incorrect).*(?:master_password|password)|master_password.*(?:invalid|wrong|incorrect)/i.test(code)
}

function clearReveal(id: string) {
  const timer = revealTimers.get(id)
  if (timer !== undefined) window.clearTimeout(timer)
  revealTimers.delete(id)
  const next = new Set(revealedIds.value)
  next.delete(id)
  revealedIds.value = next
}

function clearAllReveals() {
  for (const timer of revealTimers.values()) window.clearTimeout(timer)
  revealTimers.clear()
  revealedIds.value = new Set()
}

function toggleReveal(id: string) {
  if (revealedIds.value.has(id)) {
    clearReveal(id)
    return
  }
  const next = new Set(revealedIds.value)
  next.add(id)
  revealedIds.value = next
  vault.recordActivity()
  revealTimers.set(id, window.setTimeout(() => clearReveal(id), 10_000))
}

function copyFeedback(label: '用户名' | '密码', receipt: VaultCopyReceipt) {
  const clearMessage = receipt.clearAfterSeconds > 0
    ? `，${receipt.clearAfterSeconds} 秒后自动清除`
    : ''
  if (receipt.historyProtection === 'applied') {
    feedback.notify(`${label}已复制${clearMessage}`, 'success', 3_600)
  } else if (receipt.historyProtection === 'unsupported') {
    feedback.notify(`${label}已复制${clearMessage}；当前平台不支持系统历史排除`, 'warning', 4_800)
  } else {
    feedback.notify(`${label}已复制${clearMessage}；系统历史保护未生效`, 'warning', 4_800)
  }
}

async function initializeVault() {
  const validation = validateVaultInitialization(setupPassword.value, setupConfirmation.value)
  formError.value = validation.error ?? ''
  formWarning.value = validation.warning ?? ''
  if (validation.error) return
  busy.value = true
  try {
    await vault.initializeVault(setupPassword.value)
    feedback.notify('加密凭据夹已创建', 'success')
  } catch {
    formError.value = '凭据夹初始化失败，请重试'
  } finally {
    setupPassword.value = ''
    setupConfirmation.value = ''
    formWarning.value = ''
    busy.value = false
  }
}

async function loadVault() {
  try {
    await settings.initialize()
    await vault.initialize(settings.settings.vaultAutoLockMinutes)
  } catch {
    vault.status = 'error'
  }
}

async function unlockVault() {
  formError.value = ''
  if (!unlockPassword.value) {
    formError.value = '请输入主密码'
    return
  }
  busy.value = true
  try {
    await vault.unlockVault(unlockPassword.value)
  } catch (error) {
    formError.value = isWrongMasterPassword(error) ? '主密码错误' : '暂时无法解锁，请重试'
  } finally {
    unlockPassword.value = ''
    busy.value = false
  }
}

async function lockVault() {
  busy.value = true
  try {
    await vault.lockVault()
    feedback.notify('凭据夹已锁定')
  } catch {
    feedback.notify('锁定未能完成，请重试', 'warning')
  } finally {
    busy.value = false
  }
}

function openCreateDialog() {
  vault.recordActivity()
  editingItem.value = undefined
  credentialDialogOpen.value = true
}

function openEditDialog(item: VaultItem) {
  vault.recordActivity()
  editingItem.value = item
  credentialDialogOpen.value = true
}

function closeCredentialDialog() {
  credentialDialogOpen.value = false
  editingItem.value = undefined
}

async function saveCredential(input: VaultItemInput) {
  busy.value = true
  try {
    if (editingItem.value) {
      await vault.updateItem(editingItem.value.id, input)
      feedback.notify('凭据已更新', 'success')
    } else {
      await vault.createItem(input)
      feedback.notify('凭据已添加', 'success')
    }
    closeCredentialDialog()
  } catch {
    feedback.notify('凭据保存失败，请重试', 'warning')
  } finally {
    busy.value = false
  }
}

async function copyItemField(item: VaultItem, field: 'username' | 'password') {
  if (field === 'username' && !item.username) return
  try {
    copyFeedback(field === 'password' ? '密码' : '用户名', await vault.copyItemField(item.id, field))
  } catch {
    feedback.notify('复制失败，凭据夹可能已锁定', 'warning')
  }
}

async function copyDraftPassword(password: string) {
  if (!password) return
  try { copyFeedback('密码', await vault.copyText(password, 'password')) }
  catch { feedback.notify('密码复制失败', 'warning') }
}

async function confirmDelete() {
  const id = deleteId.value
  deleteId.value = undefined
  if (!id) return
  try {
    await vault.deleteItem(id)
    clearReveal(id)
    feedback.notify('凭据已删除', 'success')
  } catch {
    feedback.notify('凭据删除失败，请重试', 'warning')
  }
}

async function confirmForgotPassword() {
  const stage = forgotStage.value
  if (!stage) return
  if (stage === 'first') {
    forgotStage.value = undefined
    await nextTick()
    forgotStage.value = 'final'
    return
  }
  forgotStage.value = undefined
  busy.value = true
  try {
    await vault.resetVault()
    feedback.notify('凭据夹已删除，可以重新初始化')
  } catch {
    feedback.notify('凭据夹删除失败，请重试', 'warning')
  } finally {
    busy.value = false
  }
}

function clearSensitiveGateInputs() {
  setupPassword.value = ''
  setupConfirmation.value = ''
  unlockPassword.value = ''
  setupPasswordsVisible.value = false
  unlockPasswordVisible.value = false
}

watch(() => vault.lockRevision, () => {
  clearSensitiveGateInputs()
  formError.value = ''
  formWarning.value = ''
  forgotStage.value = undefined
  clearAllReveals()
  closeCredentialDialog()
  deleteId.value = undefined
})

watch(() => vault.status, (status) => {
  formError.value = ''
  formWarning.value = ''
  if (status === 'unlocked') return
  clearAllReveals()
  closeCredentialDialog()
  deleteId.value = undefined
})

onMounted(() => void loadVault())
onUnmounted(() => {
  clearSensitiveGateInputs()
  clearAllReveals()
})
</script>

<template>
  <section class="vault-panel" :data-status="vault.status">
    <div v-if="vault.status === 'loading'" class="vault-state loading-state" role="status">
      <span><RefreshCw :size="24" /></span><h2>正在打开凭据夹</h2><p>读取本地加密状态……</p>
    </div>

    <div v-else-if="vault.status === 'error'" class="vault-state error-state" role="alert">
      <span><LockKeyhole :size="25" /></span><h2>凭据夹暂时无法打开</h2><p>本地数据库或加密服务暂时不可用。</p>
      <button type="button" @click="loadVault"><RefreshCw :size="15" />重试</button>
    </div>

    <div v-else-if="vault.status === 'uninitialized'" class="vault-gate setup-gate">
      <div class="gate-heading"><span><ShieldCheck :size="27" /></span><div><h2>设置主密码</h2><p>凭据加密后仅保存在本机。</p></div></div>
      <form @submit.prevent="initializeVault">
        <label>主密码<span class="gate-password"><input v-model="setupPassword" :type="setupPasswordsVisible ? 'text' : 'password'" autocomplete="new-password" autofocus /><button type="button" :aria-label="setupPasswordsVisible ? '隐藏主密码' : '显示主密码'" :aria-pressed="setupPasswordsVisible" @click="setupPasswordsVisible = !setupPasswordsVisible"><EyeOff v-if="setupPasswordsVisible" :size="16" /><Eye v-else :size="16" /></button></span></label>
        <label>再次确认主密码<input v-model="setupConfirmation" :type="setupPasswordsVisible ? 'text' : 'password'" autocomplete="new-password" /></label>
        <p v-if="formError" class="form-message error" role="alert">{{ formError }}</p>
        <p v-if="formWarning || setupPasswordRisk" class="form-message warning" role="status">{{ formWarning || setupPasswordRisk }}</p>
        <button class="gate-submit" type="submit" :disabled="busy">{{ busy ? '正在初始化' : '创建凭据夹' }}</button>
      </form>
      <p class="recovery-notice"><Lock :size="15" />主密码不会被保存。忘记后，现有凭据无法恢复。</p>
    </div>

    <div v-else-if="vault.status === 'locked'" class="vault-gate unlock-gate">
      <div class="lock-emblem"><LockKeyhole :size="29" /></div>
      <div class="gate-heading centered"><div><h2>加密凭据夹</h2><p>输入主密码后查看本地凭据。</p></div></div>
      <form @submit.prevent="unlockVault">
        <label class="sr-label" for="vault-master-password">主密码</label>
        <span class="gate-password"><input id="vault-master-password" v-model="unlockPassword" :type="unlockPasswordVisible ? 'text' : 'password'" autocomplete="current-password" autofocus placeholder="主密码" /><button type="button" :aria-label="unlockPasswordVisible ? '隐藏主密码' : '显示主密码'" :aria-pressed="unlockPasswordVisible" @click="unlockPasswordVisible = !unlockPasswordVisible"><EyeOff v-if="unlockPasswordVisible" :size="16" /><Eye v-else :size="16" /></button></span>
        <p v-if="formError" class="form-message error" role="alert">{{ formError }}</p>
        <button class="gate-submit" type="submit" :disabled="busy">{{ busy ? '正在解锁' : '解锁' }}</button>
      </form>
      <button class="forgot-button" type="button" @click="forgotStage = 'first'">忘记主密码？</button>
    </div>

    <template v-else>
      <header class="vault-toolbar">
        <div><span><LockKeyhole :size="19" /></span><div><h2>加密凭据夹</h2><p>{{ vault.items.length }} 项本地凭据</p></div></div>
        <button type="button" :disabled="busy" @click="lockVault"><Lock :size="15" />锁定</button>
      </header>
      <div class="vault-actions">
        <label class="vault-search"><Search :size="16" /><input type="search" aria-label="搜索凭据" placeholder="搜索系统或账号……" :value="vault.search" @input="vault.setSearch(($event.target as HTMLInputElement).value)" /></label>
        <button class="add-credential" type="button" @click="openCreateDialog"><Plus :size="15" />新增凭据</button>
      </div>

      <div v-if="vault.filteredItems.length" class="credential-list">
        <article v-for="item in vault.filteredItems" :key="item.id" class="credential-card">
          <header><div><span><KeyRound :size="17" /></span><div><h3>{{ item.title }}</h3><p>{{ item.username || '未填写用户名' }}</p></div></div><div class="card-menu"><button type="button" aria-label="编辑凭据" title="编辑" @click="openEditDialog(item)"><Pencil :size="14" /></button><button type="button" aria-label="删除凭据" title="删除" @click="deleteId = item.id"><Trash2 :size="14" /></button></div></header>
          <div class="credential-field"><span><UserRound :size="14" />用户名</span><strong>{{ item.username || '—' }}</strong><button type="button" aria-label="复制用户名" :disabled="!item.username" @click="copyItemField(item, 'username')"><Copy :size="14" />复制</button></div>
          <div class="credential-field password-row"><span><KeyRound :size="14" />密码</span><strong :class="{ revealed: revealedIds.has(item.id) }">{{ revealedIds.has(item.id) ? item.password : '••••••••••••' }}</strong><button type="button" :aria-label="revealedIds.has(item.id) ? '隐藏密码' : '显示密码'" :aria-pressed="revealedIds.has(item.id)" @click="toggleReveal(item.id)"><EyeOff v-if="revealedIds.has(item.id)" :size="14" /><Eye v-else :size="14" /></button><button type="button" aria-label="复制密码" @click="copyItemField(item, 'password')"><Copy :size="14" />复制</button></div>
          <p v-if="item.note" class="credential-note">{{ item.note }}</p>
        </article>
      </div>
      <div v-else class="vault-empty"><span><KeyRound :size="25" /></span><h3>{{ vault.items.length ? '没有匹配的凭据' : '还没有凭据' }}</h3><p>{{ vault.items.length ? '试试其他系统名称或账号。' : '添加第一个经常使用的系统账号。' }}</p><button v-if="!vault.items.length" type="button" @click="openCreateDialog"><Plus :size="15" />新增凭据</button></div>
    </template>

    <VaultCredentialDialog :open="credentialDialogOpen" :item="editingItem" :busy="busy" @cancel="closeCredentialDialog" @save="saveCredential" @copy-password="copyDraftPassword" />
    <UiConfirmDialog :open="Boolean(deleteId)" title="删除该凭据？" :message="`将永久删除“${deleteTitle}”，此操作无法撤销。`" confirm-label="删除" @cancel="deleteId = undefined" @confirm="confirmDelete" />
    <UiConfirmDialog :open="Boolean(forgotStage)" :title="forgotTitle" :message="forgotMessage" :confirm-label="forgotStage === 'final' ? '永久删除' : '继续'" :confirm-delay-ms="forgotStage === 'final' ? 600 : 0" @cancel="forgotStage = undefined" @confirm="confirmForgotPassword" />
  </section>
</template>

<style scoped>
.vault-panel { min-height: 350px; display: grid; align-content: start; gap: 11px; color: var(--color-text); }.vault-state { min-height: 330px; display: grid; place-items: center; align-content: center; gap: 6px; text-align: center; }.vault-state > span, .lock-emblem { width: 58px; height: 58px; display: grid; place-items: center; border-radius: 19px; color: var(--color-quick-actions); background: color-mix(in srgb, var(--color-quick-actions) 11%, transparent); }.vault-state h2, .vault-state p { margin: 0; }.vault-state h2 { font-size: 17px; }.vault-state p { color: var(--color-text-muted); font-size: var(--font-size-body-compact); }.loading-state svg { animation: vault-spin 1.2s linear infinite; }.vault-state button, .vault-empty button { min-height: 34px; display: inline-flex; align-items: center; gap: 5px; margin-top: 6px; padding: 6px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-pill); color: var(--color-text-secondary); background: var(--color-surface); font-size: var(--font-size-button); cursor: pointer; }
.vault-gate { width: min(390px, 100%); min-height: 350px; display: grid; align-content: center; gap: 14px; margin: 0 auto; }.gate-heading { display: flex; align-items: center; gap: 11px; }.gate-heading > span { width: 48px; height: 48px; display: grid; flex: 0 0 auto; place-items: center; border-radius: var(--radius-md); color: var(--color-quick-actions); background: color-mix(in srgb, var(--color-quick-actions) 11%, transparent); }.gate-heading h2, .gate-heading p { margin: 0; }.gate-heading h2 { font-size: 18px; }.gate-heading p { margin-top: 3px; color: var(--color-text-muted); font-size: var(--font-size-body-compact); }.gate-heading.centered { justify-content: center; text-align: center; }.lock-emblem { margin: 0 auto -4px; }
.vault-gate form { display: grid; gap: 9px; }.vault-gate label { display: grid; gap: 5px; color: var(--color-text-secondary); font-size: var(--font-size-body-compact); font-weight: 650; }.vault-gate input { width: 100%; min-width: 0; min-height: 40px; padding: 8px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); color: var(--color-text); background: var(--color-surface-soft); outline: 0; }.gate-password { display: grid; grid-template-columns: minmax(0, 1fr) 38px; gap: 5px; }.gate-password button { display: grid; place-items: center; border: 1px solid var(--color-border); border-radius: var(--radius-xs); color: var(--color-text-muted); background: var(--color-surface); cursor: pointer; }.vault-gate input:focus { border-color: var(--color-focus); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-focus) 14%, transparent); }.gate-submit { min-height: 38px; border: 0; border-radius: var(--radius-pill); color: var(--color-on-accent); background: var(--color-quick-actions); font-size: var(--font-size-button); font-weight: 650; cursor: pointer; }.form-message { margin: 0; font-size: var(--font-size-caption); }.form-message.error { color: #d45d61; }.form-message.warning { color: #a46b20; }.recovery-notice { display: flex; align-items: flex-start; gap: 7px; margin: 0; padding: 9px 10px; border-radius: var(--radius-xs); color: var(--color-text-secondary); background: var(--color-surface-soft); font-size: var(--font-size-caption); line-height: 1.45; }.recovery-notice svg { flex: 0 0 auto; margin-top: 1px; }.forgot-button { justify-self: center; border: 0; color: var(--color-text-muted); background: transparent; font-size: var(--font-size-caption); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }.sr-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.vault-toolbar, .vault-toolbar > div, .vault-actions, .credential-card header, .credential-card header > div, .card-menu { display: flex; align-items: center; }.vault-toolbar { justify-content: space-between; gap: 10px; }.vault-toolbar > div { gap: 8px; }.vault-toolbar > div > span { width: 36px; height: 36px; display: grid; place-items: center; border-radius: var(--radius-sm); color: var(--color-quick-actions); background: color-mix(in srgb, var(--color-quick-actions) 10%, transparent); }.vault-toolbar h2, .vault-toolbar p { margin: 0; }.vault-toolbar h2 { font-size: 16px; }.vault-toolbar p { margin-top: 2px; color: var(--color-text-muted); font-size: var(--font-size-caption); }.vault-toolbar > button, .add-credential { min-height: 34px; display: inline-flex; align-items: center; gap: 5px; padding: 6px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-pill); color: var(--color-text-secondary); background: var(--color-surface); font-size: var(--font-size-button); cursor: pointer; }.vault-actions { gap: 8px; }.vault-search { min-height: 39px; flex: 1; display: flex; align-items: center; gap: 7px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text-muted); background: var(--color-surface-soft); }.vault-search:focus-within { border-color: var(--color-focus); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-focus) 14%, transparent); }.vault-search input { width: 100%; min-width: 0; border: 0; color: var(--color-text); background: transparent; font-size: var(--font-size-body); outline: 0; }.add-credential { min-height: 39px; color: var(--color-quick-actions); border-color: color-mix(in srgb, var(--color-quick-actions) 25%, var(--color-border)); }
.credential-list { max-height: 300px; display: grid; gap: 8px; overflow-y: auto; padding-right: 2px; }.credential-card { display: grid; gap: 7px; padding: 10px 11px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: linear-gradient(145deg, color-mix(in srgb, var(--color-quick-actions) 5%, var(--color-surface)), var(--color-surface)); }.credential-card header { justify-content: space-between; gap: 10px; }.credential-card header > div:first-child { min-width: 0; gap: 8px; }.credential-card header > div:first-child > span { width: 32px; height: 32px; display: grid; flex: 0 0 auto; place-items: center; border-radius: var(--radius-xs); color: var(--color-quick-actions); background: color-mix(in srgb, var(--color-quick-actions) 10%, transparent); }.credential-card h3, .credential-card header p { overflow: hidden; margin: 0; text-overflow: ellipsis; white-space: nowrap; }.credential-card h3 { font-size: var(--font-size-body); }.credential-card header p { margin-top: 1px; color: var(--color-text-muted); font-size: var(--font-size-caption); }.card-menu { gap: 2px; }.card-menu button, .credential-field button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; border: 0; border-radius: var(--radius-pill); color: var(--color-text-muted); background: transparent; font-size: var(--font-size-button); cursor: pointer; }.card-menu button { width: 28px; height: 28px; }.card-menu button:hover, .credential-field button:hover { color: var(--color-quick-actions); background: var(--color-surface-hover); }
.credential-field { min-width: 0; display: grid; grid-template-columns: 82px minmax(0, 1fr) auto; align-items: center; gap: 6px; padding-top: 6px; border-top: 1px solid var(--color-border-subtle); }.credential-field > span { display: inline-flex; align-items: center; gap: 5px; color: var(--color-text-muted); font-size: var(--font-size-caption); }.credential-field strong { overflow: hidden; color: var(--color-text-secondary); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: var(--font-size-body-compact); font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }.credential-field strong.revealed { color: var(--color-text); }.credential-field button { min-height: 27px; padding: 4px 7px; }.password-row { grid-template-columns: 82px minmax(0, 1fr) 29px auto; }.password-row > button:nth-of-type(1) { width: 29px; padding: 0; }.credential-note { margin: 0; padding: 7px 8px; border-radius: var(--radius-xs); color: var(--color-text-secondary); background: var(--color-surface-soft); font-size: var(--font-size-body-compact); line-height: 1.4; white-space: pre-wrap; word-break: break-word; }
.vault-empty { min-height: 245px; display: grid; place-items: center; align-content: center; gap: 5px; text-align: center; }.vault-empty > span { width: 50px; height: 50px; display: grid; place-items: center; border-radius: 17px; color: var(--color-quick-actions); background: color-mix(in srgb, var(--color-quick-actions) 10%, transparent); }.vault-empty h3, .vault-empty p { margin: 0; }.vault-empty h3 { margin-top: 4px; font-size: 16px; }.vault-empty p { color: var(--color-text-muted); font-size: var(--font-size-body-compact); }
button:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }@keyframes vault-spin { to { transform: rotate(360deg); } }@media (max-width: 500px) { .vault-actions { align-items: stretch; flex-direction: column; }.add-credential { justify-content: center; }.credential-field, .password-row { grid-template-columns: 78px minmax(0, 1fr) auto; }.password-row > button:nth-of-type(1) { grid-column: 3; }.password-row > button:last-child { grid-column: 2 / 4; justify-self: end; } }@media (prefers-reduced-motion: reduce) { .loading-state svg { animation: none; } }
</style>
