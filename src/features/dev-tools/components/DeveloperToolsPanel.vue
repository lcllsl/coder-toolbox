<script setup lang="ts">
import { computed, ref } from 'vue'
import { Binary, Braces, Clock3, Fingerprint, Link, QrCode } from '@lucide/vue'

import Base64Tool from './tools/Base64Tool.vue'
import JsonTool from './tools/JsonTool.vue'
import QrCodeTool from './tools/QrCodeTool.vue'
import TimestampTool from './tools/TimestampTool.vue'
import UrlTool from './tools/UrlTool.vue'
import UuidTool from './tools/UuidTool.vue'
import './dev-tools.css'

const tools = [
  { id: 'json', label: 'JSON', icon: Braces, component: JsonTool },
  { id: 'url', label: 'URL', icon: Link, component: UrlTool },
  { id: 'base64', label: 'Base64', icon: Binary, component: Base64Tool },
  { id: 'timestamp', label: '时间戳', icon: Clock3, component: TimestampTool },
  { id: 'qr-code', label: '二维码', icon: QrCode, component: QrCodeTool },
  { id: 'uuid', label: 'UUID', icon: Fingerprint, component: UuidTool },
] as const

const activeId = ref<(typeof tools)[number]['id']>('json')
const activeTool = computed(() => tools.find((tool) => tool.id === activeId.value) ?? tools[0])
</script>

<template>
  <section class="developer-tools">
    <nav class="tool-switcher" aria-label="开发转换工具">
      <button
        v-for="tool in tools"
        :key="tool.id"
        type="button"
        :class="{ active: activeId === tool.id }"
        :aria-current="activeId === tool.id ? 'page' : undefined"
        @click="activeId = tool.id"
      >
        <component :is="tool.icon" :size="17" aria-hidden="true" />
        <span>{{ tool.label }}</span>
      </button>
    </nav>
    <Transition name="tool-slide" mode="out-in">
      <KeepAlive>
        <component :is="activeTool.component" :key="activeTool.id" />
      </KeepAlive>
    </Transition>
  </section>
</template>
