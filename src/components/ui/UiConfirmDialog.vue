<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  confirmDelayMs?: number
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const dialogCard = ref<HTMLElement>()
const cancelButton = ref<HTMLButtonElement>()
const confirmReady = ref(true)
let previousFocus: HTMLElement | null = null
let confirmTimer: number | undefined

function clearConfirmTimer() {
  if (confirmTimer !== undefined) window.clearTimeout(confirmTimer)
  confirmTimer = undefined
}

function prepareConfirm() {
  clearConfirmTimer()
  const delay = Math.max(0, props.confirmDelayMs ?? 0)
  confirmReady.value = delay === 0
  if (delay > 0) {
    confirmTimer = window.setTimeout(() => {
      confirmTimer = undefined
      confirmReady.value = true
    }, delay)
  }
}

function restoreFocus() {
  previousFocus?.focus({ preventScroll: true })
  previousFocus = null
}

function focusCancel() {
  cancelButton.value?.focus({ preventScroll: true })
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    event.preventDefault()
    emit('cancel')
    return
  }
  if (event.key !== 'Tab' || !dialogCard.value) return
  const focusable = [...dialogCard.value.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(() => props.open, async (open) => {
  if (!open) {
    clearConfirmTimer()
    confirmReady.value = true
    restoreFocus()
    return
  }
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  prepareConfirm()
  await nextTick()
  focusCancel()
}, { flush: 'post' })

onUnmounted(() => {
  clearConfirmTimer()
  restoreFocus()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog" @after-enter="focusCancel">
      <div
        v-if="open"
        class="dialog-backdrop"
        @click.self="emit('cancel')"
        @keydown="handleKeydown"
      >
        <section ref="dialogCard" class="dialog-card" role="alertdialog" aria-modal="true" :aria-label="title">
          <h2>{{ title }}</h2>
          <p>{{ message }}</p>
          <div class="dialog-actions">
            <button ref="cancelButton" class="secondary" type="button" @click="emit('cancel')">取消</button>
            <button class="primary" type="button" :disabled="!confirmReady" @click="emit('confirm')">
              {{ confirmLabel ?? '确认' }}
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  z-index: 40;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgb(10 14 22 / 28%);
  backdrop-filter: blur(4px);
}

.dialog-card {
  width: min(360px, 100%);
  padding: 22px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
}

.dialog-card h2 { margin: 0 0 8px; font-size: 18px; }
.dialog-card p { margin: 0; color: var(--color-text-secondary); line-height: 1.6; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 22px; }
.dialog-actions button { padding: 8px 14px; border-radius: var(--radius-pill); cursor: pointer; }
.secondary { border: 1px solid var(--color-border); color: var(--color-text); background: transparent; }
.primary { border: 0; color: var(--color-on-accent); background: var(--color-orb-end); }
.primary:disabled { cursor: not-allowed; opacity: .58; }
.dialog-enter-active, .dialog-leave-active { transition: opacity var(--duration-normal); }
.dialog-enter-active .dialog-card, .dialog-leave-active .dialog-card { transition: transform var(--duration-normal); }
.dialog-enter-from, .dialog-leave-to { opacity: 0; }
.dialog-enter-from .dialog-card, .dialog-leave-to .dialog-card { transform: scale(0.94) translateY(8px); }
@media (prefers-reduced-motion: reduce) {
  .dialog-enter-active, .dialog-leave-active, .dialog-enter-active .dialog-card, .dialog-leave-active .dialog-card { transition: none; }
}
</style>
