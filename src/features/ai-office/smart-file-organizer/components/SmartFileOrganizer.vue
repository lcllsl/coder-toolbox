<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, FolderOpen, FolderTree, LoaderCircle, Play, RotateCcw, Search, ShieldCheck, Sparkles, XCircle } from '@lucide/vue'
import UiConfirmDialog from '@/components/ui/UiConfirmDialog.vue'
import { useFeedbackStore } from '@/app/stores/feedback'
import { useSettingsStore } from '@/app/stores/settings'
import { classifyOrganizerFiles, aiErrorMessage } from '@/services/tauri/ai'
import { selectDirectory, openDirectory } from '@/services/tauri/files'
import { cancelFileOrganize, executeFileOrganize, organizerErrorMessage, scanOrganizerDirectory, undoFileOrganize, validateOrganizerPlan } from '@/services/tauri/file-organizer'
import { parseAiClassifications } from '../ai-validation'
import { buildMovePlan, isAiRule, normalizeDictionaryText, sanitizeDirectoryName, toAiMeta } from '../planner'
import { loadDictionaries, saveDictionaries } from '../repositories/dictionary-repository'
import type { AiDimension, AiFileClassificationItem, ClassificationDictionary, ConflictStrategy, FileMeta, FileMovePlan, FileOrganizeProgress, FileOrganizeResult, FileOrganizeRule, FileTypeGroup, UndoResult } from '../types'

const emit = defineEmits<{ back: [] }>()
const feedback = useFeedbackStore()
const settings = useSettingsStore()
const step = ref<'select' | 'rules' | 'planning' | 'preview' | 'executing' | 'done'>('select')
const rootDirectory = ref('')
const recursive = ref(false)
const fileTypes = ref<FileTypeGroup[]>(['word', 'excel', 'powerpoint', 'pdf'])
const excludedNameText = ref('')
const excludedDirectoryText = ref('归档\n已整理')
const files = ref<FileMeta[]>([])
const scanning = ref(false)
const errorMessage = ref('')
const rules = ref<FileOrganizeRule[]>([
  { id: crypto.randomUUID(), type: 'year', source: 'modifiedAt', aiRequired: false, enabled: true, order: 0 },
  { id: crypto.randomUUID(), type: 'fileType', aiRequired: false, enabled: true, order: 1 },
])
const dictionaries = ref<ClassificationDictionary>({})
const dictionaryDrafts = ref<Partial<Record<AiDimension, string>>>({})
const plan = ref<FileMovePlan[]>([])
const filter = ref<'all' | 'review' | 'conflict'>('all')
const dryRun = ref(true)
const aiConsent = ref(false)
const conflictStrategy = ref<ConflictStrategy>('rename')
const confirmExecution = ref(false)
const progress = ref<FileOrganizeProgress>()
const result = ref<FileOrganizeResult>()
const undoResult = ref<UndoResult>()
const draggedRule = ref<number>()
const activeTaskId = ref('')
const confirmedConflicts = ref(new Set<string>())

const typeChoices: { value: FileTypeGroup; label: string }[] = [
  { value: 'word', label: 'Word' }, { value: 'excel', label: 'Excel' }, { value: 'powerpoint', label: 'PowerPoint' },
  { value: 'pdf', label: 'PDF' }, { value: 'text', label: '文本' }, { value: 'other', label: '其他' },
]
const ruleChoices: { value: FileOrganizeRule['type']; label: string; ai: boolean }[] = [
  { value: 'year', label: '年份', ai: false }, { value: 'quarter', label: '季度', ai: false }, { value: 'month', label: '月份', ai: false },
  { value: 'day', label: '日期', ai: false }, { value: 'fileType', label: '文件格式', ai: false }, { value: 'department', label: '部门', ai: true },
  { value: 'person', label: '人员', ai: true }, { value: 'project', label: '项目', ai: true }, { value: 'documentType', label: '文档类型', ai: true }, { value: 'topic', label: '主题', ai: true },
]
const ruleLabels = Object.fromEntries(ruleChoices.map((item) => [item.value, item.label])) as Record<FileOrganizeRule['type'], string>
const orderedRules = computed(() => [...rules.value].sort((a, b) => a.order - b.order))
const enabledAiDimensions = computed(() => orderedRules.value.filter((rule) => rule.enabled && isAiRule(rule.type)).map((rule) => rule.type as AiDimension))
const filteredPlan = computed(() => plan.value.filter((item) => filter.value === 'all' || (filter.value === 'review' ? item.status === 'needs_confirmation' : item.status === 'conflict')))
const movablePlan = computed(() => plan.value.filter((item) => item.selected && item.status !== 'unchanged'))
const planStats = computed(() => ({
  ready: plan.value.filter((item) => item.selected && item.status === 'ready').length,
  review: plan.value.filter((item) => item.status === 'needs_confirmation').length,
  unchanged: plan.value.filter((item) => item.status === 'unchanged').length,
  directories: new Set(plan.value.flatMap((item) => item.targetSegments.map((_, index) => item.targetSegments.slice(0, index + 1).join('/')))).size,
}))
const directoryTree = computed(() => {
  const counts = new Map<string, number>()
  for (const item of plan.value) counts.set(item.targetSegments.join(' / '), (counts.get(item.targetSegments.join(' / ')) ?? 0) + 1)
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
})

onMounted(async () => {
  await settings.initialize()
  dictionaries.value = await loadDictionaries()
  for (const [key, values] of Object.entries(dictionaries.value)) dictionaryDrafts.value[key as AiDimension] = values?.join('\n') ?? ''
})

async function chooseRoot() {
  const selected = await selectDirectory('选择需要整理的目录')
  if (selected) rootDirectory.value = selected
}

async function scan() {
  if (!rootDirectory.value || !fileTypes.value.length) return
  scanning.value = true; errorMessage.value = ''
  try {
    files.value = await scanOrganizerDirectory(rootDirectory.value, {
      recursive: recursive.value, fileTypes: fileTypes.value,
      excludedNameKeywords: normalizeDictionaryText(excludedNameText.value), excludedDirectories: normalizeDictionaryText(excludedDirectoryText.value),
    })
    if (!files.value.length) { errorMessage.value = '没有找到符合筛选条件的办公文件'; return }
    step.value = 'rules'
  } catch (error) { errorMessage.value = organizerErrorMessage(error) }
  finally { scanning.value = false }
}

function setQuickRule(types: FileOrganizeRule['type'][]) {
  rules.value = types.map((type, order) => ({ id: crypto.randomUUID(), type, source: type === 'year' || type === 'quarter' || type === 'month' || type === 'day' ? 'modifiedAt' : undefined, aiRequired: isAiRule(type), enabled: true, order }))
}

function addRule() {
  if (rules.value.length >= 3) return
  const type = ruleChoices.find((choice) => !rules.value.some((rule) => rule.type === choice.value))?.value ?? 'fileType'
  rules.value.push({ id: crypto.randomUUID(), type, source: 'modifiedAt', aiRequired: isAiRule(type), enabled: true, order: rules.value.length })
}

function updateRuleType(rule: FileOrganizeRule) { rule.aiRequired = isAiRule(rule.type) }
function reorderRule(index: number, direction: -1 | 1) {
  const sorted = orderedRules.value
  const target = index + direction
  if (target < 0 || target >= sorted.length) return
  ;[sorted[index].order, sorted[target].order] = [sorted[target].order, sorted[index].order]
}
function dropRule(index: number) { if (draggedRule.value !== undefined) reorderRule(draggedRule.value, index - draggedRule.value); draggedRule.value = undefined }

async function generatePlan(withoutAi = false) {
  if (!orderedRules.value.length) return
  errorMessage.value = ''; step.value = 'planning'
  const classifications: AiFileClassificationItem[] = []
  try {
    for (const dimension of enabledAiDimensions.value) dictionaries.value[dimension] = normalizeDictionaryText(dictionaryDrafts.value[dimension] ?? '')
    await saveDictionaries(dictionaries.value)
    if (enabledAiDimensions.value.length && !withoutAi) {
      if (!aiConsent.value) throw new Error('请先确认 AI 仅接收页面列出的有限文件信息')
      for (let offset = 0; offset < files.value.length; offset += 80) {
        const batch = files.value.slice(offset, offset + 80)
        const ids = new Set(batch.map((file) => file.id))
        let reason: string | undefined
        let parsed: AiFileClassificationItem[] | undefined
        for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
          try {
            const raw = await classifyOrganizerFiles(settings.settings.aiModel, enabledAiDimensions.value, dictionaries.value, batch.map(toAiMeta), reason)
            parsed = parseAiClassifications(raw, ids, enabledAiDimensions.value, dictionaries.value)
          } catch (error) {
            reason = error instanceof Error && error.message.startsWith('file_classification_') ? error.message : undefined
            if (!reason || attempt === 1) throw error
          }
        }
        const returned = new Map((parsed ?? []).map((item) => [item.fileId, item]))
        for (const file of batch) classifications.push(returned.get(file.id) ?? { fileId: file.id, categories: {}, confidence: 'low', reason: 'AI 未返回该文件的可靠分类' })
      }
    }
    plan.value = buildMovePlan(files.value, orderedRules.value, classifications)
    step.value = 'preview'
  } catch (error) {
    errorMessage.value = error instanceof Error && error.message.startsWith('请先') ? error.message : aiErrorMessage(error)
    step.value = 'rules'
  }
}

function removeAiAndContinue() {
  rules.value = rules.value.filter((rule) => !rule.aiRequired).map((rule, order) => ({ ...rule, order }))
  void generatePlan(true)
}

function updateTarget(item: FileMovePlan, value: string) {
  confirmedConflicts.value.delete(item.fileId)
  item.targetSegments = value.split(/[\\/]/).map(sanitizeDirectoryName).filter(Boolean).slice(0, 3)
  item.status = item.targetSegments.includes('待确认') ? 'needs_confirmation' : 'ready'
  item.selected = item.status === 'ready'
}

function handleSelection(item: FileMovePlan) {
  if (item.status !== 'conflict') return
  if (item.selected) confirmedConflicts.value.add(item.fileId)
  else confirmedConflicts.value.delete(item.fileId)
}

async function prepareExecution() {
  errorMessage.value = ''
  if (conflictStrategy.value === 'confirm') {
    try {
      const conflicts = await validateOrganizerPlan(rootDirectory.value, movablePlan.value)
      const unresolved = conflicts.filter((id) => !confirmedConflicts.value.has(id))
      for (const item of plan.value) {
        if (unresolved.includes(item.fileId)) { item.status = 'conflict'; item.selected = false }
      }
      if (unresolved.length) {
        filter.value = 'conflict'
        errorMessage.value = `发现 ${unresolved.length} 个同名冲突。请逐项重新勾选以确认安全编号，或修改目标目录。`
        return
      }
    } catch (error) { errorMessage.value = organizerErrorMessage(error); return }
  }
  confirmExecution.value = true
}

async function execute() {
  confirmExecution.value = false; step.value = 'executing'; errorMessage.value = ''
  const taskId = crypto.randomUUID()
  activeTaskId.value = taskId
  try {
    result.value = await executeFileOrganize(rootDirectory.value, taskId, movablePlan.value, conflictStrategy.value === 'confirm' ? 'rename' : conflictStrategy.value, (value) => { progress.value = value })
    step.value = 'done'
  } catch (error) { errorMessage.value = organizerErrorMessage(error); step.value = 'preview' }
}

async function cancelExecution() { if (!activeTaskId.value) return; await cancelFileOrganize(activeTaskId.value) }

async function undo() {
  if (!result.value) return
  try { undoResult.value = await undoFileOrganize(result.value.manifest); feedback.notify(`已恢复 ${undoResult.value.restored} 个文件`, 'success') }
  catch (error) { feedback.notify(organizerErrorMessage(error), 'warning') }
}

function reset() { step.value = 'select'; files.value = []; plan.value = []; result.value = undefined; undoResult.value = undefined; progress.value = undefined; activeTaskId.value = ''; confirmedConflicts.value.clear(); errorMessage.value = '' }
</script>

<template>
  <section class="organizer">
    <header class="toolbar"><button type="button" @click="step === 'select' ? emit('back') : reset()"><ArrowLeft :size="16" />{{ step === 'select' ? 'AI 办公' : '重新开始' }}</button><nav aria-label="整理进度"><span :class="{ active: step === 'select' }">目录</span><i /> <span :class="{ active: step === 'rules' || step === 'planning' }">规则</span><i /> <span :class="{ active: step === 'preview' || step === 'executing' }">预览</span><i /> <span :class="{ active: step === 'done' }">完成</span></nav></header>

    <div v-if="step === 'select'" class="select-stage">
      <div class="heading"><span><FolderTree :size="29" /></span><div><h2>智能文件整理</h2><p>扫描有限文件信息，自动规划目录并安全整理归档</p></div></div>
      <div class="directory-card"><FolderOpen :size="32" /><strong>{{ rootDirectory || '当前尚未选择目录' }}</strong><button type="button" @click="chooseRoot">选择目录</button></div>
      <div v-if="rootDirectory" class="scan-settings">
        <fieldset><legend>扫描范围</legend><label><input v-model="recursive" :value="false" type="radio" />仅当前目录</label><label><input v-model="recursive" :value="true" type="radio" />包含所有子目录</label><small v-if="recursive">不会跟随 Symbolic Link 或 Junction，递归扫描可能涉及较多文件。</small></fieldset>
        <fieldset><legend>文件类型</legend><label v-for="type in typeChoices" :key="type.value"><input v-model="fileTypes" :value="type.value" type="checkbox" />{{ type.label }}</label></fieldset>
        <div class="exclude-grid"><label><span>排除文件名包含（每行一个）</span><textarea v-model="excludedNameText" rows="3" placeholder="临时&#10;备份" /></label><label><span>排除目录（精确名称）</span><textarea v-model="excludedDirectoryText" rows="3" /></label></div>
      </div>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
      <footer><button class="primary" type="button" :disabled="!rootDirectory || !fileTypes.length || scanning" @click="scan"><LoaderCircle v-if="scanning" class="spin" :size="16" /><Search v-else :size="16" />{{ scanning ? '正在扫描' : '扫描文件' }}</button></footer>
    </div>

    <div v-else-if="step === 'rules'" class="rules-stage">
      <div class="section-heading"><div><h2>选择整理规则</h2><p>已扫描 {{ files.length }} 个文件，最多组合 3 层目录。</p></div></div>
      <div class="quick-rules"><button @click="setQuickRule(['year'])">按时间</button><button @click="setQuickRule(['fileType'])">按格式</button><button @click="setQuickRule(['department'])">按部门 ✨</button><button @click="setQuickRule(['person'])">按人员 ✨</button><button @click="setQuickRule(['project'])">按项目 ✨</button><button @click="setQuickRule(['year','department','fileType'])">年份 + 部门 + 格式</button></div>
      <div class="rule-list">
        <article v-for="(rule,index) in orderedRules" :key="rule.id" draggable="true" @dragstart="draggedRule=index" @dragover.prevent @drop="dropRule(index)">
          <b>{{ index + 1 }}</b><select v-model="rule.type" @change="updateRuleType(rule)"><option v-for="choice in ruleChoices" :key="choice.value" :value="choice.value">{{ choice.label }}</option></select>
          <span :class="rule.aiRequired ? 'ai' : 'local'">{{ rule.aiRequired ? '✨ AI' : '本地' }}</span>
          <select v-if="['year','quarter','month','day'].includes(rule.type)" v-model="rule.source"><option value="modifiedAt">修改时间</option><option value="createdAt">创建时间</option></select><span v-else />
          <button aria-label="上移" @click="reorderRule(index,-1)"><ArrowUp :size="14" /></button><button aria-label="下移" @click="reorderRule(index,1)"><ArrowDown :size="14" /></button><button aria-label="删除规则" @click="rules=rules.filter(item=>item.id!==rule.id)"><XCircle :size="15" /></button>
        </article>
        <button v-if="rules.length<3" class="add" type="button" @click="addRule">+ 添加一层规则</button>
      </div>
      <div v-for="dimension in enabledAiDimensions" :key="dimension" class="dictionary"><label><strong>{{ ruleLabels[dimension] }}分类字典</strong><small>可选；填写后 AI 只能从这些值中选择</small><textarea v-model="dictionaryDrafts[dimension]" rows="3" placeholder="每行一个常用分类" /></label></div>
      <div v-if="enabledAiDimensions.length" class="privacy"><ShieldCheck :size="18" /><div><strong>AI 只会收到文件名、扩展名、父目录名、时间和大小</strong><small>不会发送正文、文件二进制或绝对路径；无法判断的文件进入“待确认”。</small></div><label><input v-model="aiConsent" type="checkbox" />我已了解</label></div>
      <p v-else class="local-note"><ShieldCheck :size="16" />当前规则无需 AI，所有处理都将在本机完成。</p>
      <p v-if="errorMessage" class="error">{{ errorMessage }} <button v-if="enabledAiDimensions.length && !errorMessage.startsWith('请先')" @click="removeAiAndContinue">移除 AI 规则并继续</button></p>
      <footer><button @click="step='select'">返回目录</button><button class="primary" :disabled="!rules.length" @click="generatePlan(false)"><Sparkles :size="16" />生成整理方案</button></footer>
    </div>

    <div v-else-if="step === 'planning'" class="center-stage"><span><LoaderCircle class="spin" :size="30" /></span><h2>正在生成整理方案</h2><p>{{ enabledAiDimensions.length ? 'AI 只分析有限元信息；目录规划仍在本机完成。' : '正在本机计算目录结构。' }}</p></div>

    <div v-else-if="step === 'preview'" class="preview-stage">
      <div class="section-heading"><div><h2>整理计划已生成</h2><p>当前仅预览方案，不会自动移动任何文件。</p></div><label class="dry"><input v-model="dryRun" type="checkbox" />仅演练，不执行</label></div>
      <div class="stats"><article><strong>{{ files.length }}</strong><span>扫描文件</span></article><article><strong>{{ planStats.ready }}</strong><span>计划移动</span></article><article><strong>{{ planStats.review }}</strong><span>需要确认</span></article><article><strong>{{ planStats.unchanged }}</strong><span>无需移动</span></article><article><strong>{{ planStats.directories }}</strong><span>预计目录</span></article></div>
      <div class="preview-grid"><section><header><strong>文件计划</strong><div><button :class="{active:filter==='all'}" @click="filter='all'">全部</button><button :class="{active:filter==='review'}" @click="filter='review'">待确认</button><button :class="{active:filter==='conflict'}" @click="filter='conflict'">冲突</button></div></header><div class="plan-table"><table><thead><tr><th></th><th>文件</th><th>当前目录</th><th>建议目录</th><th>状态</th></tr></thead><tbody><tr v-for="item in filteredPlan" :key="item.fileId"><td><input v-model="item.selected" type="checkbox" :disabled="item.status==='unchanged'" @change="handleSelection(item)" /></td><td :title="item.reason"><strong>{{ item.fileName }}</strong><small v-if="item.reason">{{ item.reason }}</small></td><td>{{ item.currentDirectory }}</td><td><input :value="item.targetSegments.join(' / ')" @change="updateTarget(item,($event.target as HTMLInputElement).value)" /></td><td><span :class="item.status">{{ item.status==='ready'?'就绪':item.status==='needs_confirmation'?'待确认':item.status==='conflict'?'冲突':'不移动' }}</span></td></tr></tbody></table></div></section><aside><strong>目录树预览</strong><ul><li v-for="([path,count]) in directoryTree" :key="path"><FolderTree :size="14" /><span>{{ path }}</span><b>{{ count }}</b></li></ul></aside></div>
      <div class="execution-options"><label>同名冲突<select v-model="conflictStrategy"><option value="rename">自动编号（默认）</option><option value="skip">跳过</option><option value="confirm">执行前逐个确认</option></select></label><p><ShieldCheck :size="16" />不删除、不改正文、不主动改名、绝不覆盖。</p></div>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
      <footer><button @click="step='rules'">修改规则</button><button v-if="dryRun" class="primary" @click="feedback.notify('演练方案已保留，没有移动任何文件','success')">完成演练</button><button v-else class="primary" :disabled="!movablePlan.length" @click="prepareExecution"><Play :size="15" />执行整理</button></footer>
    </div>

    <div v-else-if="step === 'executing'" class="center-stage"><span><LoaderCircle class="spin" :size="30" /></span><h2>正在整理文件</h2><strong>{{ progress?.completed ?? 0 }} / {{ progress?.total ?? movablePlan.length }}</strong><p>当前：{{ progress?.currentFile || '准备目录' }}</p><button v-if="progress" @click="cancelExecution">停止后续文件</button></div>

    <div v-else class="done-stage"><span class="success"><CheckCircle2 :size="34" /></span><h2>{{ result?.cancelled ? '整理已停止' : '文件整理完成' }}</h2><div class="stats"><article><strong>{{ result?.moved ?? 0 }}</strong><span>成功移动</span></article><article><strong>{{ result?.manifest.createdDirectories.length ?? 0 }}</strong><span>创建目录</span></article><article><strong>{{ result?.skipped ?? 0 }}</strong><span>跳过</span></article><article><strong>{{ result?.failed.length ?? 0 }}</strong><span>失败</span></article></div><p v-if="result?.failed.length" class="error">{{ result.failed.map(item=>item.fileName).join('、') }} 移动失败，文件可能被占用或目录无权限。</p><p v-if="undoResult">撤销完成：恢复 {{ undoResult.restored }} 个，冲突 {{ undoResult.conflicts.length }} 个，失败 {{ undoResult.failed.length }} 个。</p><footer><button @click="openDirectory(rootDirectory)"><FolderOpen :size="15" />打开整理目录</button><button :disabled="!result?.manifest.moves.length || !!undoResult" @click="undo"><RotateCcw :size="15" />撤销本次整理</button><button class="primary" @click="reset">整理其他目录</button></footer></div>

    <UiConfirmDialog :open="confirmExecution" title="确认执行文件整理" :message="`即将移动 ${movablePlan.length} 个文件并创建约 ${planStats.directories} 个目录。不会删除文件、修改正文、主动修改文件名或覆盖同名文件。`" confirm-label="确认执行" @cancel="confirmExecution=false" @confirm="execute" />
  </section>
</template>

<style scoped>
.organizer{display:grid;gap:13px;color:var(--color-text)}button,select,input,textarea{font:inherit}.toolbar{display:flex;align-items:center;justify-content:space-between}.toolbar>button,footer button,.quick-rules button,.center-stage button{display:flex;align-items:center;gap:5px;padding:6px 10px;border:1px solid var(--color-border);border-radius:99px;color:var(--color-text-secondary);background:var(--color-surface);font-size:12px;cursor:pointer}.toolbar nav{display:flex;align-items:center;gap:7px;color:var(--color-text-muted);font-size:11px}.toolbar nav i{width:22px;height:1px;background:var(--color-border)}.toolbar nav .active{color:var(--color-ai-office);font-weight:700}.select-stage,.rules-stage,.preview-stage,.done-stage{display:grid;gap:12px}.heading{display:flex;align-items:center;justify-content:center;gap:12px}.heading>span,.center-stage>span,.done-stage>.success{width:58px;height:58px;display:grid;place-items:center;border-radius:19px;color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 12%,transparent)}h2,p{margin:0}h2{font-size:20px}.heading p,.section-heading p,.center-stage p{margin-top:3px;color:var(--color-text-muted);font-size:12px}.directory-card{min-height:145px;display:grid;place-items:center;align-content:center;gap:9px;padding:18px;border:1.5px dashed color-mix(in srgb,var(--color-ai-office) 42%,var(--color-border));border-radius:20px;background:color-mix(in srgb,var(--color-ai-office) 5%,var(--color-surface))}.directory-card svg{color:var(--color-ai-office)}.directory-card strong{max-width:80%;overflow:hidden;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.directory-card button,.primary{min-height:36px;padding:7px 14px;border:0!important;border-radius:99px;color:#fff!important;background:var(--color-ai-office)!important;cursor:pointer}.scan-settings{display:grid;grid-template-columns:1fr 1fr;gap:10px}.scan-settings fieldset,.exclude-grid{padding:11px;border:1px solid var(--color-border-subtle);border-radius:12px;background:var(--color-surface-soft)}fieldset legend{font-size:12px;font-weight:700}fieldset label{display:inline-flex;align-items:center;gap:5px;margin:5px 12px 0 0;font-size:12px}fieldset small{display:block;margin-top:7px;color:#9b702b;font-size:10px}.exclude-grid{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:9px}.exclude-grid label,.dictionary label{display:grid;gap:4px}.exclude-grid span,.dictionary strong{font-size:11px}.exclude-grid textarea,.dictionary textarea{resize:vertical}.scan-settings textarea,.dictionary textarea{padding:7px;border:1px solid var(--color-border);border-radius:8px;color:var(--color-text);background:var(--color-surface);font-size:11px}footer{display:flex;justify-content:flex-end;gap:8px}.section-heading{display:flex;align-items:center;justify-content:space-between}.quick-rules{display:flex;flex-wrap:wrap;gap:6px}.quick-rules button{border-color:color-mix(in srgb,var(--color-ai-office) 20%,var(--color-border));color:var(--color-ai-office)}.rule-list{display:grid;gap:6px}.rule-list article{display:grid;grid-template-columns:26px 150px 60px 130px 28px 28px 28px;align-items:center;gap:6px;padding:8px;border:1px solid var(--color-border-subtle);border-radius:10px;background:var(--color-surface);cursor:grab}.rule-list article>b{width:24px;height:24px;display:grid;place-items:center;border-radius:50%;background:var(--color-surface-soft);font-size:11px}.rule-list select,.execution-options select{min-height:31px;padding:4px 7px;border:1px solid var(--color-border);border-radius:7px;color:var(--color-text);background:var(--color-surface-soft);font-size:11px}.rule-list article>span{font-size:10px}.rule-list .ai{color:var(--color-ai-office)}.rule-list .local{color:#397b68}.rule-list article>button{width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:50%;color:var(--color-text-muted);background:transparent;cursor:pointer}.rule-list .add{justify-self:start;padding:6px 10px;border:1px dashed var(--color-border);border-radius:9px;color:var(--color-ai-office);background:transparent;font-size:11px}.dictionary{padding:9px 11px;border-radius:10px;background:var(--color-surface-soft)}.dictionary label{grid-template-columns:130px 1fr}.dictionary small{color:var(--color-text-muted);font-size:10px}.dictionary textarea{grid-column:1/-1}.privacy,.local-note,.execution-options{display:flex;align-items:center;gap:9px;padding:10px 12px;border-radius:11px;color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 7%,var(--color-surface))}.privacy>div{flex:1;display:grid;gap:2px}.privacy strong{color:var(--color-text);font-size:11px}.privacy small{color:var(--color-text-muted);font-size:10px}.privacy label{display:flex;gap:5px;font-size:11px}.local-note{font-size:11px}.error{padding:8px 10px;border-radius:9px;color:#b75a55;background:color-mix(in srgb,#d16b63 10%,transparent);font-size:11px}.error button{border:0;color:inherit;text-decoration:underline;background:transparent;cursor:pointer}.center-stage{min-height:500px;display:grid;place-items:center;align-content:center;gap:10px;text-align:center}.center-stage>strong{font-size:21px}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:7px}.stats article{padding:9px;border:1px solid var(--color-border-subtle);border-radius:11px;text-align:center;background:var(--color-surface)}.stats strong,.stats span{display:block}.stats strong{font-size:18px}.stats span{margin-top:2px;color:var(--color-text-muted);font-size:10px}.dry{display:flex;align-items:center;gap:5px;font-size:11px}.preview-grid{display:grid;grid-template-columns:minmax(0,2.2fr) minmax(210px,1fr);gap:9px}.preview-grid>section,.preview-grid>aside{min-width:0;border:1px solid var(--color-border-subtle);border-radius:11px;background:var(--color-surface)}.preview-grid header{display:flex;align-items:center;justify-content:space-between;padding:8px 10px}.preview-grid header strong,.preview-grid aside>strong{font-size:12px}.preview-grid header button{padding:3px 7px;border:0;border-radius:99px;color:var(--color-text-muted);background:transparent;font-size:10px;cursor:pointer}.preview-grid header button.active{color:var(--color-ai-office);background:color-mix(in srgb,var(--color-ai-office) 10%,transparent)}.plan-table{max-height:300px;overflow:auto;border-top:1px solid var(--color-border-subtle)}table{width:100%;border-collapse:collapse;font-size:10px}th,td{padding:7px;border-bottom:1px solid var(--color-border-subtle);text-align:left}th{position:sticky;top:0;background:var(--color-surface-soft)}td strong,td small{display:block;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}td small{margin-top:2px;color:var(--color-text-muted);font-size:9px}td>input:not([type=checkbox]){width:160px;padding:4px;border:1px solid var(--color-border);border-radius:6px;color:var(--color-text);background:var(--color-surface-soft);font-size:10px}td>span{font-size:9px}.ready{color:#397b68}.needs_confirmation,.conflict{color:#a46b20}.unchanged{color:var(--color-text-muted)}.preview-grid aside{max-height:344px;overflow:auto;padding:9px}.preview-grid aside ul{display:grid;gap:5px;margin:8px 0 0;padding:0;list-style:none}.preview-grid aside li{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:5px;padding:5px;border-radius:6px;background:var(--color-surface-soft);font-size:10px}.preview-grid aside b{color:var(--color-text-muted)}.execution-options{justify-content:space-between}.execution-options label{display:flex;align-items:center;gap:7px;color:var(--color-text-secondary);font-size:11px}.execution-options p{display:flex;align-items:center;gap:5px;font-size:10px}.done-stage{min-height:480px;place-items:center;align-content:center;text-align:center}.done-stage .stats{width:min(560px,100%);grid-template-columns:repeat(4,1fr)}.done-stage footer{margin-top:8px}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--color-focus);outline-offset:2px}button:disabled{cursor:not-allowed;opacity:.48}@media(max-width:760px){.scan-settings,.exclude-grid,.preview-grid{grid-template-columns:1fr}.rule-list article{grid-template-columns:24px 1fr 55px auto auto auto}.rule-list article>select:nth-of-type(2){grid-column:2/5}.stats{grid-template-columns:repeat(3,1fr)}}@media(prefers-reduced-motion:reduce){.spin{animation:none}}
</style>
