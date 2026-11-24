<script setup lang="ts">
import { ElAlert, ElButton, ElCheckbox, ElDialog, ElInputNumber } from 'element-plus'
import 'element-plus/es/components/alert/style/css'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/checkbox/style/css'
import 'element-plus/es/components/dialog/style/css'
import 'element-plus/es/components/input-number/style/css'
import { computed, ref, shallowRef, useId } from 'vue'
import {
  balanceColumnLayout, MIN_SUBJECT_WIDTH, toCentimeters, toColumnUnits, type TableColumnLayout, type TableColumnSettings,
} from './tableColumnLayout'

const props = defineProps<{ apply: (layout: TableColumnLayout) => boolean }>()
const emit = defineEmits<{ closed: [] }>()

const formId = useId()
const form = ref<HTMLFormElement | null>(null)
const visible = ref(false)
const draft = shallowRef<TableColumnSettings | null>(null)
const linked = ref<number[]>([])
const error = ref('')
const balanceIndex = computed(() => draft.value?.subjectIndex ?? 0)
const editableColumns = computed(() =>
  draft.value?.layout.widths.flatMap((_, index) => index === balanceIndex.value ? [] : [index]) ?? [],
)
const allLinked = computed(() => editableColumns.value.length > 0 && linked.value.length === editableColumns.value.length)

const subjectError = '科目列至少需要 0.20 厘米。请减小其他列宽或表格左缩进。'

const show = (settings: TableColumnSettings) => {
  draft.value = settings
  linked.value = []
  error.value = ''
  visible.value = true
}

const focusFirstField = () => {
  form.value?.querySelector<HTMLInputElement>('input[type="number"]:not(:disabled)')?.focus({ preventScroll: true })
}

const setLinked = (index: number, value: unknown) => {
  linked.value = value === true ? [...linked.value, index] : linked.value.filter(column => column !== index)
  error.value = ''
}

const linkAll = (value: unknown) => {
  linked.value = value === true ? [...editableColumns.value] : []
  error.value = ''
}

const updateLayout = (layout: TableColumnLayout) => {
  const current = draft.value
  if (!current) return
  const next = balanceColumnLayout(layout, current.availableWidth, balanceIndex.value)
  if (next.widths[balanceIndex.value]! < MIN_SUBJECT_WIDTH) {
    error.value = current.subjectIndex === null
      ? '表格至少需要 0.20 厘米宽。请减小左缩进。' : subjectError
    return
  }
  draft.value = { ...current, layout: next }
  error.value = ''
}

const updateColumn = (index: number, value: number | null | undefined) => {
  const current = draft.value
  if (!current || index === balanceIndex.value) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.01) {
    error.value = '请输入大于 0 的列宽。'
    return
  }
  const columns = linked.value.includes(index) ? linked.value : [index]
  const widths = [...current.layout.widths]
  for (const column of columns) widths[column] = toColumnUnits(value)
  updateLayout({ ...current.layout, widths })
}

const updateIndent = (value: number | null | undefined) => {
  const current = draft.value
  if (!current) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    error.value = '请输入不小于 0 的左缩进。'
    return
  }
  updateLayout({ ...current.layout, indentLeft: toColumnUnits(value) })
}

const submit = () => {
  if (!draft.value || error.value) return
  const { layout, subjectIndex } = draft.value
  if (layout.widths[balanceIndex.value]! < MIN_SUBJECT_WIDTH) {
    error.value = subjectIndex === null ? '表格至少需要 0.20 厘米宽。请减小左缩进。' : subjectError
    return
  }
  if (layout.widths.some(width => width <= 0)) {
    error.value = '各列宽度必须大于 0 厘米。'
    return
  }
  if (!props.apply(layout)) {
    error.value = '表格或页面尺寸已有变化。请关闭弹框后重新打开。'
    return
  }
  visible.value = false
}

const commitField = (event: KeyboardEvent) => {
  if (event.target instanceof HTMLInputElement) event.target.blur()
}

defineExpose({ show })
</script>

<template>
  <ElDialog
    v-model="visible"
    class="word-table-column-dialog"
    title="表格列宽与缩进"
    width="min(480px, calc(100vw - 32px))"
    align-center
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
    @opened="focusFirstField"
    @closed="emit('closed')"
  >
    <form v-if="draft" :id="formId" ref="form" class="word-table-column-form" novalidate @submit.prevent="submit">
      <div class="word-table-column-toolbar">
        <ElCheckbox
          :model-value="allLinked"
          :indeterminate="linked.length > 0 && !allLinked"
          :disabled="editableColumns.length === 0"
          @change="linkAll"
        >全选联动列</ElCheckbox>
        <span>表格宽度 {{ toCentimeters(draft.availableWidth - draft.layout.indentLeft).toFixed(2) }} 厘米</span>
      </div>

      <p v-if="draft.subjectIndex === null" class="word-table-column-note">序号表的第 2 列是科目列。当前仅有一列，列宽随表格宽度调整。</p>

      <div class="word-table-column-list">
        <div v-for="(width, index) in draft.layout.widths" :key="index" class="word-table-column-field">
          <ElCheckbox
            v-if="index !== balanceIndex"
            :aria-label="`联动第 ${index + 1} 列`"
            :model-value="linked.includes(index)"
            @change="setLinked(index, $event)"
          />
          <span v-else aria-hidden="true" />
          <label :for="`${formId}-column-${index}`">第 {{ index + 1 }} 列</label>
          <ElInputNumber
            :id="`${formId}-column-${index}`"
            :name="`column-${index + 1}`"
            :aria-label="`第 ${index + 1} 列宽度（厘米）`"
            :model-value="toCentimeters(width)"
            :disabled="index === balanceIndex"
            :controls="index !== balanceIndex"
            :step="0.01"
            :precision="2"
            :value-on-clear="null"
            controls-position="right"
            inputmode="decimal"
            @change="updateColumn(index, $event)"
            @keydown.enter.prevent="commitField"
          >
            <template #suffix>厘米</template>
          </ElInputNumber>
          <span v-if="index === balanceIndex" class="word-table-column-tag">
            {{ draft.subjectIndex === null ? '随表宽' : '科目列' }}
          </span>
        </div>
      </div>

      <div class="word-table-column-indent">
        <label :for="`${formId}-indent`">表格左缩进</label>
        <ElInputNumber
          :id="`${formId}-indent`"
          name="table-indent"
          aria-label="表格左缩进（厘米）"
          :model-value="toCentimeters(draft.layout.indentLeft)"
          :step="0.01"
          :precision="2"
          :value-on-clear="null"
          controls-position="right"
          inputmode="decimal"
          @change="updateIndent"
          @keydown.enter.prevent="commitField"
        >
          <template #suffix>厘米</template>
        </ElInputNumber>
      </div>
      <ElAlert v-if="error" :title="error" type="warning" @close="error = ''" />
    </form>
    <template #footer>
      <ElButton @click="visible = false">取消</ElButton>
      <ElButton type="primary" native-type="submit" :form="formId">确定</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.word-table-column-form {
  display: grid;
  gap: 12px;
}

.word-table-column-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #687181;
  font-size: 12px;
}

.word-table-column-list {
  display: grid;
  max-height: min(400px, 48dvh);
  gap: 6px;
  overflow-y: auto;
  padding: 2px 6px 2px 1px;
}

.word-table-column-field {
  display: grid;
  grid-template-columns: 20px 58px minmax(0, 1fr) 52px;
  align-items: center;
  gap: 8px;
}

.word-table-column-form .el-input-number {
  width: 100%;
}

.word-table-column-tag {
  color: #185abd;
  font-size: 12px;
}

.word-table-column-note {
  color: #687181;
  font-size: 12px;
}

.word-table-column-indent {
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr) 52px;
  align-items: center;
  gap: 8px;
  border-top: 1px solid #e5e7eb;
  padding-top: 12px;
}
</style>
