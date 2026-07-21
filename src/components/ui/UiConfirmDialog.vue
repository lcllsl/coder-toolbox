<script setup lang="ts">
defineProps<{
  open: boolean
  title: string
  message: string
  confirmLabel?: string
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="open"
        class="dialog-backdrop"
        @click.self="emit('cancel')"
        @keydown.esc.stop.prevent="emit('cancel')"
      >
        <section class="dialog-card" role="alertdialog" aria-modal="true" :aria-label="title">
          <h2>{{ title }}</h2>
          <p>{{ message }}</p>
          <div class="dialog-actions">
            <button class="secondary" type="button" @click="emit('cancel')">取消</button>
            <button class="primary" type="button" autofocus @click="emit('confirm')">
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
.dialog-enter-active, .dialog-leave-active { transition: opacity var(--duration-normal); }
.dialog-enter-active .dialog-card, .dialog-leave-active .dialog-card { transition: transform var(--duration-normal); }
.dialog-enter-from, .dialog-leave-to { opacity: 0; }
.dialog-enter-from .dialog-card, .dialog-leave-to .dialog-card { transform: scale(0.94) translateY(8px); }
</style>
