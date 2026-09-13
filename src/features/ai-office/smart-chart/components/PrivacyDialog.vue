<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ShieldCheck, X } from '@lucide/vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ cancel: []; confirm: [neverShowAgain: boolean] }>()
const neverShowAgain = ref(false)
const dialog = ref<HTMLElement>()
onMounted(() => dialog.value?.focus())
</script>

<template>
  <Transition name="privacy">
    <div v-if="open" class="privacy-backdrop" @click.self="emit('cancel')">
      <section ref="dialog" class="privacy-dialog" role="dialog" aria-modal="true" aria-labelledby="privacy-title" tabindex="-1">
        <header><span><ShieldCheck :size="22" /></span><div><h2 id="privacy-title">AI 数据处理说明</h2><p>生成前，请了解将发送给 DeepSeek 的内容。</p></div><button type="button" aria-label="关闭" @click="emit('cancel')"><X :size="18" /></button></header>
        <div class="privacy-content"><p><strong>Excel 文件本身不会上传。</strong></p><p>冒泡只会发送字段名称、字段类型、少量样例和基础统计，用于推荐图表。</p><p>疑似身份证、手机号、银行卡、邮箱、密码、Token 和长 ID 的样例值默认替换为 <code>[REDACTED]</code>。</p></div>
        <label><input v-model="neverShowAgain" type="checkbox" />我已了解，不再提示</label>
        <footer><button type="button" @click="emit('cancel')">取消</button><button type="button" class="primary" @click="emit('confirm', neverShowAgain)">继续生成</button></footer>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.privacy-backdrop{position:fixed;z-index:70;inset:0;display:grid;place-items:center;padding:24px;background:rgb(18 22 32/42%);backdrop-filter:blur(6px)}.privacy-dialog{width:min(480px,100%);padding:18px;border:1px solid var(--color-border);border-radius:20px;color:var(--color-text);background:var(--color-surface);box-shadow:var(--shadow-panel);outline:0}.privacy-dialog header{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px}.privacy-dialog header>span{width:42px;height:42px;display:grid;place-items:center;border-radius:14px;color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 12%,transparent)}h2,p{margin:0}h2{font-size:17px}header p{margin-top:3px;color:var(--color-text-muted);font-size:12px}header button{width:34px;height:34px;display:grid;place-items:center;border:0;border-radius:50%;color:var(--color-text-muted);background:transparent;cursor:pointer}.privacy-content{display:grid;gap:8px;margin:16px 0;padding:13px;border-radius:12px;background:var(--color-surface-soft)}.privacy-content p{font-size:13px;line-height:1.55}.privacy-content p:not(:first-child){color:var(--color-text-secondary)}code{color:var(--color-ai-office)}label{display:flex;align-items:center;gap:7px;color:var(--color-text-secondary);font-size:13px}label input{accent-color:var(--color-ai-office)}footer{display:flex;justify-content:flex-end;gap:8px;margin-top:17px}footer button{min-height:36px;padding:6px 14px;border:1px solid var(--color-border);border-radius:99px;color:var(--color-text-secondary);background:var(--color-surface);font-size:12px;cursor:pointer}footer .primary{border-color:transparent;color:#fff;background:var(--color-ai-office)}button:focus-visible,input:focus-visible{outline:2px solid var(--color-focus);outline-offset:2px}.privacy-enter-active,.privacy-leave-active{transition:opacity 160ms}.privacy-enter-from,.privacy-leave-to{opacity:0}@media(prefers-reduced-motion:reduce){.privacy-enter-active,.privacy-leave-active{transition-duration:20ms}}
</style>
