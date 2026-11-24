<script setup lang="ts">
import { ElAlert, ElButton, ElDialog, ElInputNumber, ElPopover } from 'element-plus'
import 'element-plus/es/components/alert/style/css'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/dialog/style/css'
import 'element-plus/es/components/input-number/style/css'
import 'element-plus/es/components/popover/style/css'
import { reactive, ref, useId, watch } from 'vue'
import WordTableBorderTools from './WordTableBorderTools.vue'
import { isValidTableSize, MAX_TABLE_CELLS, type TableSize } from '../WordEditor/tableSize'

const props = withDefaults(defineProps<{
  disabled: boolean
  insertOnly?: boolean
  numbered?: boolean | null
}>(), {
  numbered: null,
})
const emit = defineEmits<{
  insert: [size: TableSize]
  toggleNumbered: []
  columnSettings: []
  openBorders: []
}>()
const gridRows = 8
const gridCols = 10
const pickerId = useId()
const formId = useId()
const trigger = ref<InstanceType<typeof ElButton> | null>(null)
const popover = ref<InstanceType<typeof ElPopover> | null>(null)
const grid = ref<HTMLElement | null>(null)
const form = ref<HTMLFormElement | null>(null)
const popoverOpen = ref(false)
const dialogOpen = ref(false)
const preview = ref<TableSize | null>(null)
const draft = reactive<{ rows: number | null | undefined; cols: number | null | undefined }>({
  rows: 2, cols: 2,
})
const invalidSize = ref(false)
let pickerAction: TableSize | 'dialog' | 'restore-focus' | undefined
let pendingSize: TableSize | undefined

const focusGrid = () => {
  grid.value?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus({ preventScroll: true })
}

const resetPicker = () => {
  popoverOpen.value = false
  preview.value = null
}

const directions: Record<string, [rows: number, cols: number] | undefined> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

const moveGridFocus = (event: KeyboardEvent) => {
  const delta = directions[event.key]
  if (!delta || !(event.target instanceof HTMLButtonElement)) return
  event.preventDefault()
  const rows = Math.max(1, Math.min(gridRows, Number(event.target.dataset.rows) + delta[0]))
  const cols = Math.max(1, Math.min(gridCols, Number(event.target.dataset.cols) + delta[1]))
  grid.value?.querySelector<HTMLButtonElement>(`[data-rows="${rows}"][data-cols="${cols}"]`)?.focus()
}

const closePicker = (action: NonNullable<typeof pickerAction>) => {
  pickerAction = action
  popover.value?.hide()
}

watch(popoverOpen, (open, _previous, onCleanup) => {
  if (!open) return

  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || dialogOpen.value) return
    event.preventDefault()
    closePicker('restore-focus')
  }
  document.addEventListener('keydown', onEscape)
  onCleanup(() => document.removeEventListener('keydown', onEscape))
})

const showDialog = () => {
  draft.rows = 2
  draft.cols = 2
  invalidSize.value = false
  pendingSize = undefined
  dialogOpen.value = true
}

const finishPicker = () => {
  const action = pickerAction
  pickerAction = undefined
  if (action === 'restore-focus') trigger.value?.ref?.focus({ preventScroll: true })
  else if (props.disabled) return
  else if (action === 'dialog') showDialog()
  else if (action) emit('insert', action)
}

const focusRowsInput = () => form.value?.querySelector<HTMLInputElement>('input')?.focus()

const confirmDialog = () => {
  if (props.disabled) return
  if (!isValidTableSize(draft)) {
    invalidSize.value = true
    return
  }
  pendingSize = { rows: draft.rows, cols: draft.cols }
  dialogOpen.value = false
}

const finishDialog = () => {
  const size = pendingSize
  pendingSize = undefined
  if (size) emit('insert', size)
  else trigger.value?.ref?.focus({ preventScroll: true })
}
</script>

<template>
  <section class="word-ribbon-group" aria-label="表格">
    <div class="word-ribbon-group-content word-table-controls">
      <ElPopover
        ref="popover"
        trigger="click"
        placement="bottom-start"
        popper-class="word-table-popover"
        :width="258"
        :offset="4"
        :show-arrow="false"
        :persistent="false"
        :disabled="disabled"
        @before-enter="popoverOpen = true"
        @before-leave="resetPicker"
        @after-enter="focusGrid"
        @after-leave="finishPicker"
      >
        <template #reference>
          <ElButton
            ref="trigger"
            text
            class="word-page-setup-button word-table-button"
            :disabled="disabled"
            :title="disabled ? '请将光标移到表格外再插入表格' : undefined"
            aria-haspopup="dialog"
            :aria-controls="popoverOpen ? pickerId : undefined"
            :aria-expanded="popoverOpen"
            @keydown.down.prevent="popoverOpen ? focusGrid() : trigger?.ref?.click()"
          >
            <span class="word-table-icon" aria-hidden="true" />
            <span class="word-page-setup-label">
              {{ insertOnly ? '插入表格' : '表格' }}
              <span class="word-style-chevron" aria-hidden="true" />
            </span>
          </ElButton>
        </template>

        <div :id="pickerId" class="word-table-picker" role="dialog" aria-label="选择表格尺寸">
          <div class="word-table-picker-size">
            {{ preview ? `${preview.cols} 列 × ${preview.rows} 行` : '选择表格尺寸' }}
          </div>
          <div ref="grid" class="word-table-size-grid" role="grid" aria-label="快速选择行列数" @keydown="moveGridFocus">
            <div v-for="rows in gridRows" :key="rows" class="word-table-size-row"
              :style="{ '--word-table-grid-columns': gridCols }" role="row">
              <ElButton
                v-for="cols in gridCols"
                :key="cols"
                class="word-table-size-cell"
                :class="{ 'is-highlighted': preview && rows <= preview.rows && cols <= preview.cols }"
                :data-rows="rows"
                :data-cols="cols"
                role="gridcell"
                :aria-label="`${cols} 列 ${rows} 行`"
                :tabindex="rows === (preview?.rows ?? 1) && cols === (preview?.cols ?? 1) ? 0 : -1"
                @mouseenter="preview = { rows, cols }"
                @focus="preview = { rows, cols }"
                @click="closePicker({ rows, cols })"
              />
            </div>
          </div>
          <ElButton text class="word-table-dialog-button" aria-haspopup="dialog" @click="closePicker('dialog')">
            <span class="word-table-icon is-small" aria-hidden="true" />
            插入表格…
          </ElButton>
        </div>
      </ElPopover>
      <template v-if="!insertOnly">
        <ElButton
          text
          class="word-page-setup-button word-table-numbered-button"
          :class="{ 'is-active': numbered }"
          :disabled="numbered === null"
          :aria-pressed="numbered === true"
          @mousedown.prevent
          @click="emit('toggleNumbered')"
        >
          <span class="word-table-icon word-numbered-table-icon" aria-hidden="true">
            <span class="word-numbered-table-digits">
              <span v-for="digit in 3" :key="digit">{{ digit }}</span>
            </span>
          </span>
          <span>序号表</span>
        </ElButton>
        <ElButton
          text
          class="word-page-setup-button word-table-column-settings-button"
          :disabled="numbered === null"
          aria-haspopup="dialog"
          @mousedown.prevent
          @click="emit('columnSettings')"
        >
          <span class="word-table-column-settings-icon" aria-hidden="true">↔</span>
          <span>列宽与缩进</span>
        </ElButton>
        <WordTableBorderTools
          :disabled="numbered === null"
          @open-borders="emit('openBorders')"
        />
      </template>
    </div>
    <span class="word-ribbon-group-title">表格</span>

    <ElDialog
      v-model="dialogOpen"
      class="word-insert-table-dialog"
      title="插入表格"
      width="min(360px, calc(100vw - 32px))"
      align-center
      append-to-body
      destroy-on-close
      :close-on-click-modal="false"
      :show-close="false"
      @opened="focusRowsInput"
      @closed="finishDialog"
    >
      <form :id="formId" ref="form" class="word-insert-table-fields" novalidate @submit.prevent="confirmDialog">
        <div>
          <label :for="formId + '-rows'">行数</label>
          <ElInputNumber
            :id="formId + '-rows'"
            v-model="draft.rows"
            name="rows"
            :min="1"
            :value-on-clear="null"
            controls-position="right"
            inputmode="numeric"
            @input="invalidSize = false"
          />
        </div>
        <div>
          <label :for="formId + '-cols'">列数</label>
          <ElInputNumber
            :id="formId + '-cols'"
            v-model="draft.cols"
            name="cols"
            :min="1"
            :value-on-clear="null"
            controls-position="right"
            inputmode="numeric"
            @input="invalidSize = false"
          />
        </div>
      </form>
      <ElAlert
        v-if="invalidSize"
        class="word-insert-table-error"
        :title="`行数和列数须为正整数，单张表格最多 ${MAX_TABLE_CELLS} 个单元格。`"
        type="error"
        :closable="false"
      />
      <template #footer>
        <ElButton @click="dialogOpen = false">取消</ElButton>
        <ElButton type="primary" native-type="submit" :form="formId" :disabled="disabled">确定</ElButton>
      </template>
    </ElDialog>
  </section>
</template>

<style src="./WordTableTools.css"></style>
