<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'
import { Copy, Eye, EyeOff, KeyRound, Save, X } from '@lucide/vue'

import { validateVaultItem } from '../core/validation'
import type { VaultItem, VaultItemInput } from '../types'

const props = defineProps<{
  open: boolean
  item?: VaultItem
  busy?: boolean
}>()

const emit = defineEmits<{
  save: [input: VaultItemInput]
  cancel: []
  copyPassword: [password: string]
}>()

const draft = reactive<VaultItemInput>({ title: '', username: '', password: '', note: '' })
const passwordVisible = ref(false)
const fieldError = ref('')
const titleInput = ref<HTMLInputElement>()
const dialogElement = ref<HTMLElement>()
let previouslyFocused: HTMLElement | null = null

function clearDraft() {
  draft.title = ''
  draft.username = ''
  draft.password = ''
  draft.note = ''
  passwordVisible.value = false
  fieldError.value = ''
}

function close() {
  if (props.busy) return
  clearDraft()
  emit('cancel')
}

function submit() {
  const result = validateVaultItem(draft)
  fieldError.value = result.error ?? ''
  if (result.error) return
  emit('save', { ...draft })
}

function trapFocus(event: KeyboardEvent) {
  const dialog = dialogElement.value
  if (!dialog) return
  const focusable = [...dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.offsetParent !== null)
  if (!focusable.length) {
    event.preventDefault()
    dialog.focus()
    return
  }
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

watch(
  [() => props.open, () => props.item],
  ([open, item], previousValues) => {
    const wasOpen = previousValues?.[0] ?? false
    if (open && !wasOpen) {
      previouslyFocused = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    }
    clearDraft()
    if (!open) {
      const focusTarget = previouslyFocused
      previouslyFocused = null
      void nextTick(() => focusTarget?.focus())
      return
    }
    if (item) {
      draft.title = item.title
      draft.username = item.username
      draft.password = item.password
      draft.note = item.note
    }
    void nextTick(() => titleInput.value?.focus())
  },
  { immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="ui-modal" :duration="{ enter: 220, leave: 160 }">
      <div
        v-if="open"
        class="vault-dialog-backdrop ui-modal-backdrop"
        @click.self="close"
        @keydown.esc.stop.prevent="close"
        @keydown.tab="trapFocus"
      >
        <section ref="dialogElement" class="vault-dialog ui-modal-surface" role="dialog" aria-modal="true" tabindex="-1" :aria-label="item ? '编辑凭据' : '新增凭据'">
          <header>
            <div>
              <span class="dialog-icon"><KeyRound :size="18" /></span>
              <div><h2>{{ item ? '编辑凭据' : '新增凭据' }}</h2><p>保存内容会在本机完成加密。</p></div>
            </div>
            <button type="button" aria-label="关闭凭据编辑" :disabled="busy" @click="close"><X :size="18" /></button>
          </header>

          <form @submit.prevent="submit">
            <label>
              <span>系统名称 <em>*</em></span>
              <input ref="titleInput" v-model="draft.title" type="text" autocomplete="off" required />
            </label>
            <label>
              <span>用户名</span>
              <input v-model="draft.username" type="text" autocomplete="off" />
            </label>
            <label>
              <span>密码 <em>*</em></span>
              <span class="password-field">
                <input
                  v-model="draft.password"
                  :type="passwordVisible ? 'text' : 'password'"
                  autocomplete="new-password"
                  required
                />
                <button
                  type="button"
                  :aria-label="passwordVisible ? '隐藏密码' : '显示密码'"
                  :aria-pressed="passwordVisible"
                  @click="passwordVisible = !passwordVisible"
                >
                  <EyeOff v-if="passwordVisible" :size="16" />
                  <Eye v-else :size="16" />
                </button>
                <button
                  type="button"
                  aria-label="复制正在编辑的密码"
                  :disabled="!draft.password"
                  @click="emit('copyPassword', draft.password)"
                >
                  <Copy :size="15" />
                </button>
              </span>
            </label>
            <label>
              <span>备注</span>
              <textarea v-model="draft.note" rows="3" />
            </label>
            <p v-if="fieldError" class="field-error" role="alert">{{ fieldError }}</p>
            <div class="dialog-actions">
              <button class="secondary" type="button" :disabled="busy" @click="close">取消</button>
              <button class="primary" type="submit" :disabled="busy">
                <Save :size="15" />{{ busy ? '正在保存' : '保存凭据' }}
              </button>
            </div>
          </form>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.vault-dialog-backdrop { padding: 28px; }
.vault-dialog { width: min(450px, 100%); max-height: calc(100vh - 56px); overflow-y: auto; padding: 18px; }
.vault-dialog > header, .vault-dialog > header > div { display: flex; align-items: center; gap: 10px; }
.vault-dialog > header { justify-content: space-between; margin-bottom: 15px; }
.dialog-icon { width: 38px; height: 38px; display: grid; flex: 0 0 auto; place-items: center; border-radius: var(--radius-sm); color: var(--color-quick-actions); background: color-mix(in srgb, var(--color-quick-actions) 11%, transparent); }
.vault-dialog h2 { margin: 0; font-size: 17px; }.vault-dialog header p { margin: 2px 0 0; color: var(--color-text-muted); font-size: var(--font-size-caption); }
.vault-dialog header > button { width: 34px; height: 34px; display: grid; place-items: center; border: 0; border-radius: 50%; color: var(--color-text-muted); background: transparent; cursor: pointer; }.vault-dialog header > button:hover { color: var(--color-text); background: var(--color-surface-hover); }
form { display: grid; gap: 11px; }label { display: grid; gap: 5px; color: var(--color-text-secondary); font-size: var(--font-size-body-compact); }label > span:first-child { font-weight: 650; }label em { color: #d45d61; font-style: normal; }
input, textarea { width: 100%; min-width: 0; padding: 8px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-xs); color: var(--color-text); background: var(--color-surface-soft); font-size: var(--font-size-body); outline: 0; }textarea { resize: vertical; line-height: 1.45; }.password-field { display: grid; grid-template-columns: minmax(0, 1fr) 34px 34px; gap: 5px; }.password-field button { display: grid; place-items: center; border: 1px solid var(--color-border); border-radius: var(--radius-xs); color: var(--color-text-muted); background: var(--color-surface); cursor: pointer; }
input:focus, textarea:focus { border-color: var(--color-focus); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-focus) 14%, transparent); }.field-error { margin: 0; color: #d45d61; font-size: var(--font-size-caption); }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 5px; }.dialog-actions button { min-height: 34px; display: inline-flex; align-items: center; gap: 5px; padding: 6px 13px; border-radius: var(--radius-pill); font-size: var(--font-size-button); cursor: pointer; }.secondary { border: 1px solid var(--color-border); color: var(--color-text-secondary); background: transparent; }.primary { border: 0; color: var(--color-on-accent); background: var(--color-quick-actions); }
button:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
</style>
