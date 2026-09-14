<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { ShieldCheck, X } from '@lucide/vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ cancel: []; confirm: [neverShowAgain: boolean] }>()
const neverShowAgain = ref(false)
const dialog = ref<HTMLElement>()
watch(() => props.open, async (open) => { if (open) { await nextTick(); dialog.value?.focus() } })
</script>

<template>
  <Teleport to="body">
    <Transition name="ui-modal" :duration="{ enter: 220, leave: 160 }">
      <div v-if="open" class="privacy-backdrop ui-modal-backdrop" @click.self="emit('cancel')" @keydown.esc.stop.prevent="emit('cancel')">
        <section ref="dialog" class="privacy-dialog ui-modal-surface" role="dialog" aria-modal="true" aria-labelledby="smart-table-privacy-title" tabindex="-1">
          <header><span><ShieldCheck :size="22" /></span><div><h2 id="smart-table-privacy-title">AI 数据处理说明</h2><p>智能表格会把你主动提交的文本发送给 DeepSeek。</p></div><button type="button" aria-label="关闭" @click="emit('cancel')"><X :size="18" /></button></header>
          <div class="privacy-content"><p>冒泡不会后台自动上传剪贴板内容。</p><p>开启隐私保护后，手机号、邮箱、身份证、银行卡和 Token 等内容会先在本机替换为匿名占位符，返回后仅在当前内存任务中还原。</p><p>原始文本、完整请求和隐私 Token Map 不写入本地历史或日志。</p></div>
          <label><input v-model="neverShowAgain" type="checkbox" />我已了解，不再提示</label>
          <footer><button type="button" @click="emit('cancel')">取消</button><button type="button" class="primary" @click="emit('confirm', neverShowAgain)">继续识别</button></footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.privacy-backdrop{padding:24px}.privacy-dialog{width:min(500px,100%);padding:18px;outline:0}.privacy-dialog header{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px}.privacy-dialog header>span{width:42px;height:42px;display:grid;place-items:center;border-radius:14px;color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 12%,transparent)}h2,p{margin:0}h2{font-size:17px}header p{margin-top:3px;color:var(--color-text-muted);font-size:12px}header button{width:34px;height:34px;display:grid;place-items:center;border:0;border-radius:50%;color:var(--color-text-muted);background:transparent;cursor:pointer}.privacy-content{display:grid;gap:8px;margin:16px 0;padding:13px;border-radius:12px;background:var(--color-surface-soft)}.privacy-content p{color:var(--color-text-secondary);font-size:13px;line-height:1.55}label{display:flex;align-items:center;gap:7px;color:var(--color-text-secondary);font-size:13px}label input{accent-color:var(--color-ai-office)}footer{display:flex;justify-content:flex-end;gap:8px;margin-top:17px}footer button{min-height:36px;padding:6px 14px;border:1px solid var(--color-border);border-radius:99px;color:var(--color-text-secondary);background:var(--color-surface);font-size:12px;cursor:pointer}footer .primary{border-color:transparent;color:#fff;background:var(--color-ai-office)}button:focus-visible,input:focus-visible{outline:2px solid var(--color-focus);outline-offset:2px}
</style>
