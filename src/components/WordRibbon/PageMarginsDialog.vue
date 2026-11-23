<script setup lang="ts">
import { ElAlert, ElButton, ElDialog, ElInputNumber } from 'element-plus'
import 'element-plus/es/components/alert/style/css'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/dialog/style/css'
import 'element-plus/es/components/input-number/style/css'
import { reactive, ref, useId } from 'vue'
import {
  MIN_CONTENT_HEIGHT_MM, MIN_CONTENT_WIDTH_MM, validPageMargins, type PageMargins, type PageOrientation,
} from '../WordEditor/pageGeometry'

const props = defineProps<{ margins: PageMargins; orientation: PageOrientation }>()
const emit = defineEmits<{ apply: [margins: PageMargins] }>()

const formId = useId()
const form = ref<HTMLFormElement | null>(null)
const visible = ref(false)
const fields = [
  { key: 'marginTop', label: '上边距' },
  { key: 'marginBottom', label: '下边距' },
  { key: 'marginLeft', label: '左边距' },
  { key: 'marginRight', label: '右边距' },
] as const
const draft = reactive<Record<keyof PageMargins, number | null | undefined>>({
  marginTop: null, marginBottom: null, marginLeft: null, marginRight: null,
})
let initialMargins = props.margins
let pendingMargins: PageMargins | undefined
const error = ref('')
const displayCm = (mm: number) => Number((mm / 10).toFixed(3))
const focusFirstMargin = () =>
  form.value?.querySelector<HTMLInputElement>('input[name="marginTop"]')?.focus({ preventScroll: true })

const show = () => {
  pendingMargins = undefined
  initialMargins = { ...props.margins }
  for (const { key } of fields) draft[key] = displayCm(initialMargins[key])
  error.value = ''
  visible.value = true
}

const apply = () => {
  const margins = { ...initialMargins }
  for (const { key } of fields) {
    const value = draft[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      error.value = '请输入四个不小于 0 的数值。'
      return
    }
    if (value !== displayCm(initialMargins[key])) {
      margins[key] = value * 10
    }
  }
  if (!validPageMargins(margins, props.orientation)) {
    error.value = `正文区域至少需要 ${MIN_CONTENT_WIDTH_MM / 10} 厘米宽、${MIN_CONTENT_HEIGHT_MM / 10} 厘米高。请减小页边距。`
    return
  }
  pendingMargins = margins
  visible.value = false
}

const applyAfterClose = () => {
  const margins = pendingMargins
  pendingMargins = undefined
  if (margins) emit('apply', margins)
}

defineExpose({ show })
</script>

<template>
  <ElDialog
    v-model="visible"
    class="word-margin-dialog"
    title="自定义页边距"
    width="min(420px, calc(100vw - 32px))"
    align-center
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
    :show-close="false"
    @opened="focusFirstMargin"
    @closed="applyAfterClose"
  >
    <form :id="formId" ref="form" class="word-margin-fields" novalidate @submit.prevent="apply">
      <div v-for="{ key, label } in fields" :key="key" class="word-margin-field">
        <label :for="`${formId}-${key}`">{{ label }}</label>
        <ElInputNumber
          :id="`${formId}-${key}`"
          v-model="draft[key]"
          :name="key"
          :aria-label="`${label}（厘米）`"
          :min="0"
          :step="0.01"
          :value-on-clear="null"
          controls-position="right"
          inputmode="decimal"
          @input="error = ''"
        >
          <template #suffix>厘米</template>
        </ElInputNumber>
      </div>
    </form>
    <ElAlert v-if="error" class="word-margin-error" :title="error" type="error" :closable="false" />
    <template #footer>
      <ElButton @click="visible = false">取消</ElButton>
      <ElButton type="primary" native-type="submit" :form="formId">确定</ElButton>
    </template>
  </ElDialog>
</template>

<style src="./PageMarginsDialog.css"></style>
