<script setup lang="ts">
import { CheckCircle2, Info, TriangleAlert, X } from '@lucide/vue'

import { useFeedbackStore } from '@/app/stores/feedback'

const feedback = useFeedbackStore()
const icons = {
  neutral: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
}
</script>

<template>
  <div class="toast-host" aria-live="polite" aria-relevant="additions">
    <TransitionGroup name="toast">
      <div v-for="toast in feedback.toasts" :key="toast.id" class="toast" :data-tone="toast.tone">
        <component :is="icons[toast.tone]" :size="17" aria-hidden="true" />
        <span>{{ toast.message }}</span>
        <button type="button" aria-label="关闭提示" @click="feedback.dismiss(toast.id)">
          <X :size="15" aria-hidden="true" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  z-index: 50;
  right: 24px;
  bottom: 24px;
  display: grid;
  gap: 8px;
  pointer-events: none;
}

.toast {
  min-width: 220px;
  max-width: 340px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 9px;
  padding: 10px 11px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  pointer-events: auto;
}

.toast[data-tone='success'] > svg { color: var(--color-health); }
.toast[data-tone='warning'] > svg { color: var(--color-dev-tools); }

.toast button {
  display: grid;
  padding: 3px;
  border: 0;
  border-radius: var(--radius-pill);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.toast-enter-active,
.toast-leave-active { transition: opacity var(--duration-normal), transform var(--duration-normal); }
.toast-enter-from,
.toast-leave-to { opacity: 0; transform: translateY(10px) scale(0.97); }
</style>
