<script setup lang="ts">
defineProps<{
  title: string
  description: string
  error?: string
  status?: string
}>()
</script>

<template>
  <section class="tool-frame" :aria-label="title">
    <header class="tool-frame-header">
      <div>
        <h2>{{ title }}</h2>
        <p>{{ description }}</p>
      </div>
      <div class="tool-options"><slot name="options" /></div>
    </header>
    <div class="tool-body"><slot /></div>
    <p v-if="error" class="tool-message error" role="alert">{{ error }}</p>
    <p v-else-if="status" class="tool-message success" role="status">{{ status }}</p>
  </section>
</template>
