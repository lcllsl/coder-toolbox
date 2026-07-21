<script setup lang="ts">
defineProps<{
  text: string
}>()
</script>

<template>
  <span class="tooltip-anchor">
    <slot />
    <span class="tooltip" role="tooltip">{{ text }}</span>
  </span>
</template>

<style scoped>
.tooltip-anchor {
  position: relative;
  display: inline-grid;
}

.tooltip {
  position: absolute;
  z-index: 20;
  right: 0;
  top: calc(100% + 7px);
  width: max-content;
  max-width: 180px;
  padding: 5px 8px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-xs);
  color: var(--color-text);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  font-size: 11px;
  line-height: 1.3;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-3px);
  transition: opacity var(--duration-fast), transform var(--duration-fast);
}

.tooltip-anchor:hover .tooltip,
.tooltip-anchor:focus-within .tooltip {
  opacity: 1;
  transform: translateY(0);
}
</style>
