<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Selection } from '@tiptap/pm/state'
import { CellSelection, deleteColumn, deleteRow, deleteTable, selectedRect } from '@tiptap/pm/tables'
import { ElButton, ElInputNumber } from 'element-plus'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/input-number/style/css'
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue'
import { tableCellCommands, type TableCellAction } from './documentTable'
import { cellAtPosition, distributeSelectedColumns } from './tableRuler'
import { readTableHeaderRows, toggleTableHeaderRows } from './tableHeaderRows'
import { readRowSwapOptions, swapSelectedRows, type RowSwapDirection } from './tableRowSwap'

const props = defineProps<{ editor: Editor }>()

const commands = { table: deleteTable, row: deleteRow, column: deleteColumn, distribute: distributeSelectedColumns, ...tableCellCommands }
type Action = keyof typeof commands | 'header'
type MenuSelection = {
  doc: ProseMirrorNode
  selection: CellSelection
  headerRows: ReturnType<typeof readTableHeaderRows>
  allRows: boolean
  allColumns: boolean
  cellAction?: TableCellAction
  canDistribute: boolean
  rowSwap: ReturnType<typeof readRowSwapOptions>
}

const labels: Record<Action, string> = {
  table: '删除表格',
  row: '删除整行',
  column: '删除整列',
  merge: '合并单元格',
  split: '拆分单元格',
  distribute: '均分列',
  header: '设置表头',
}

const active = shallowRef<MenuSelection | null>(null)
const position = shallowRef({ left: 0, top: 0 })
const menu = useTemplateRef<HTMLElement>('menu')
const actions = computed<Action[]>(() => {
  const target = active.value
  if (!target) return []
  const items: Action[] = []
  if (target.cellAction) items.push(target.cellAction)
  if (target.canDistribute) items.push('distribute')
  items.push('header')
  if (target.allRows && target.allColumns) items.push('table')
  else items.push('row', 'column')
  return items
})

const rowSwapActions = [
  { direction: 'up', label: '与当前行上方第', icon: '↑' },
  { direction: 'down', label: '与当前行下方第', icon: '↓' },
] as const
const swaps = computed(() => rowSwapActions.flatMap(action => {
  const distances = active.value?.rowSwap[action.direction]
  return distances?.length ? [{ ...action, min: distances[0]!, max: distances[distances.length - 1]! }] : []
}))
const swapDistances = shallowRef({ up: 0, down: 0 })

const setSwapDistance = (direction: RowSwapDirection, value: number | null | undefined) => {
  const distances = active.value?.rowSwap[direction]
  if (!distances?.length || typeof value !== 'number') return

  const higher = distances.findIndex(distance => distance >= value)
  const previous = swapDistances.value[direction]
  // Skip overlapping targets and targets that would cut through a rowspan.
  const index = higher === -1 ? distances.length - 1
    : distances[higher] === value || value >= previous ? higher : Math.max(0, higher - 1)
  swapDistances.value = { ...swapDistances.value, [direction]: distances[index]! }
}

const dismiss = () => { active.value = null }

const matchesSelection = (target: MenuSelection) => {
  const { doc, selection } = props.editor.state
  return doc === target.doc && selection.eq(target.selection)
}

const dismissIfSelectionChanged = () => {
  if (active.value && !matchesSelection(active.value)) dismiss()
}

const onContextMenu = async (event: MouseEvent) => {
  const { state, view } = props.editor
  const { selection } = state
  if (!(selection instanceof CellSelection) || !(event.target instanceof Element)) return

  const element = event.target.closest('td, th')
  if (!element || !view.dom.contains(element)) return
  const cell = cellAtPosition(state.doc.resolve(view.posAtDOM(element, 0)))
  if (!cell) return

  const rect = selectedRect(state)
  if (!rect.map.cellsInRect(rect).includes(cell.pos - rect.tableStart)) return

  const target: MenuSelection = {
    doc: state.doc,
    selection,
    headerRows: readTableHeaderRows(rect.table, rect.tableStart, rect.top, rect.bottom),
    allRows: rect.top === 0 && rect.bottom === rect.map.height,
    allColumns: rect.left === 0 && rect.right === rect.map.width,
    canDistribute: rect.right - rect.left >= 2,
    rowSwap: readRowSwapOptions(rect),
  }
  if (tableCellCommands.merge(state)) target.cellAction = 'merge'
  else if (tableCellCommands.split(state)) target.cellAction = 'split'

  event.preventDefault()
  position.value = { left: event.clientX, top: event.clientY }
  swapDistances.value = { up: target.rowSwap.up[0] ?? 0, down: target.rowSwap.down[0] ?? 0 }
  active.value = target
  await nextTick()

  const elementMenu = menu.value
  if (active.value !== target || !elementMenu) return
  const { width, height } = elementMenu.getBoundingClientRect()
  const { clientWidth, clientHeight } = document.documentElement
  const gap = 4
  position.value = {
    left: Math.max(gap, Math.min(event.clientX, clientWidth - width - gap)),
    top: Math.max(gap, Math.min(event.clientY, clientHeight - height - gap)),
  }
  elementMenu.querySelector('button')?.focus({ preventScroll: true })
}

const execute = (action: Action) => {
  const target = active.value
  dismiss()
  if (!target || !matchesSelection(target)) return

  const { state, view } = props.editor
  if (action === 'header') {
    view.dispatch(closeHistory(toggleTableHeaderRows(state.tr, target.headerRows)))
    view.focus()
    return
  }

  const deletesTable = action === 'table'
    || (action === 'row' && target.allRows)
    || (action === 'column' && target.allColumns)
  commands[deletesTable ? 'table' : action](state, transaction => {
    const { doc } = transaction
    if (deletesTable && doc.childCount === 1 && doc.firstChild?.childCount === 0) {
      const paragraph = state.schema.nodes.paragraph?.create()
      if (paragraph) {
        transaction.insert(1, paragraph)
        transaction.setSelection(Selection.atStart(transaction.doc))
      }
    }
    view.dispatch(closeHistory(transaction).scrollIntoView())
  })
  view.focus()
}

const executeSwap = (direction: RowSwapDirection, event: MouseEvent) => {
  if (event.target instanceof Element && event.target.closest('.el-input-number')) return

  const target = active.value
  if (!target || !matchesSelection(target)) return
  const { state, view } = props.editor
  const transaction = swapSelectedRows(state, direction, swapDistances.value[direction])
  if (!transaction) return
  dismiss()
  view.dispatch(closeHistory(transaction).scrollIntoView())
  view.focus()
}

const focusNext = (step: number, event: KeyboardEvent) => {
  if (event.target instanceof HTMLInputElement) return
  event.preventDefault()

  const buttons = Array.from(menu.value?.querySelectorAll('button') ?? [])
  const index = buttons.findIndex(button => button === document.activeElement)
  buttons[(index + step + buttons.length) % buttons.length]?.focus({ preventScroll: true })
}

const closeAndFocusEditor = () => {
  dismiss()
  props.editor.view.focus()
}

const dismissOutside = (event: Event) => {
  if (active.value && event.target instanceof Node && !menu.value?.contains(event.target)) dismiss()
}

const listeners = new AbortController()
onMounted(() => {
  const { signal } = listeners
  props.editor.view.dom.addEventListener('contextmenu', onContextMenu, { signal })
  props.editor.on('transaction', dismissIfSelectionChanged)
  document.addEventListener('pointerdown', dismissOutside, { capture: true, signal })
  document.addEventListener('focusin', dismissOutside, { signal })
  window.addEventListener('scroll', dismissOutside, { capture: true, passive: true, signal })
  window.addEventListener('resize', dismiss, { signal })
  window.addEventListener('blur', dismiss, { signal })
})
onBeforeUnmount(() => {
  listeners.abort()
  props.editor.off('transaction', dismissIfSelectionChanged)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="active"
      ref="menu"
      class="word-table-context-menu"
      role="menu"
      aria-label="表格操作"
      :style="{ left: position.left + 'px', top: position.top + 'px' }"
      @contextmenu.prevent
      @keydown.down="focusNext(1, $event)"
      @keydown.up="focusNext(-1, $event)"
      @keydown.esc.stop.prevent="closeAndFocusEditor"
    >
      <ElButton
        v-for="action in actions"
        :key="action"
        text
        role="menuitem"
        class="word-table-context-action"
        @click="execute(action)"
      >
        <span
          v-if="action === 'merge' || action === 'split' || action === 'distribute'"
          class="word-table-cell-command-icon"
          :class="'is-' + action"
          aria-hidden="true"
        />
        <span v-else class="word-table-delete-icon" :class="'is-' + action" aria-hidden="true">
          <span v-for="cell in 9" :key="cell" />
        </span>
        {{ action === 'header' && active.headerRows.allHeaders ? '取消表头' : labels[action] }}
      </ElButton>
      <div
        v-for="{ direction, label, icon, min, max } in swaps"
        :key="direction"
        class="word-table-row-swap"
        @click="executeSwap(direction, $event)"
      >
        <span class="word-table-row-swap-label">
          <span class="word-table-row-swap-icon" aria-hidden="true">{{ icon }}</span>
          {{ label }}
        </span>
        <ElInputNumber
          :aria-label="label + '几行交换'"
          :model-value="swapDistances[direction]"
          :min="min"
          :max="max"
          :step="1"
          :precision="0"
          controls-position="right"
          size="small"
          @change="setSwapDistance(direction, $event)"
        />
        <ElButton
          text
          role="menuitem"
          class="word-table-context-action"
          :aria-label="label + swapDistances[direction] + '行交换'"
        >行交换</ElButton>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.word-table-context-menu {
  position: fixed;
  z-index: 1000;
  display: grid;
  min-width: 136px;
  gap: 2px;
  padding: 4px;
  border: 1px solid #d8dce3;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 4px 14px rgb(15 23 42 / 18%);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.word-table-context-action.el-button {
  justify-content: flex-start;
  margin: 0;
  padding: 0 9px;
  color: #273142;
}

.word-table-context-action :deep(> span) {
  gap: 8px;
}

.word-table-row-swap {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px 0 9px;
  border-radius: var(--el-border-radius-base);
  color: #273142;
  font-size: 14px;
  cursor: pointer;
}

.word-table-row-swap:hover {
  background: var(--el-fill-color-light);
}

.word-table-row-swap-label {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.word-table-row-swap .word-table-context-action {
  padding: 0 4px;
}

.word-table-row-swap .el-input-number {
  width: 66px;
}

.word-table-row-swap-icon {
  width: 16px;
  color: #546274;
  font-size: 16px;
  text-align: center;
}

.word-table-delete-icon {
  display: grid;
  width: 16px;
  height: 16px;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 1px;
  border: 1px solid #697282;
  border-radius: 1px;
  background: #697282;
}

.word-table-delete-icon > span {
  background: #fff;
}

.word-table-delete-icon.is-row > :nth-child(n + 4):nth-child(-n + 6),
.word-table-delete-icon.is-column > :nth-child(3n + 2),
.word-table-delete-icon.is-table > span {
  background: #ed9a9a;
}

.word-table-delete-icon.is-header > :nth-child(-n + 3) {
  background: #aac6eb;
}

.word-table-cell-command-icon {
  width: 16px;
  height: 16px;
  border: 1px solid #697282;
  border-radius: 1px;
  background: #e3edfa;
}

.word-table-cell-command-icon.is-split {
  background: linear-gradient(#697282, #697282) center / 1px 100% no-repeat, #e3edfa;
}

.word-table-cell-command-icon.is-distribute {
  background:
    linear-gradient(#697282, #697282) 33.33% / 1px 100% no-repeat,
    linear-gradient(#697282, #697282) 66.67% / 1px 100% no-repeat,
    #e3edfa;
}
</style>
