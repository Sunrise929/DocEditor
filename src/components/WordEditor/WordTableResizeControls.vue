<script setup lang="ts">
import { findParentNodeClosestToPos, type Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { readTableRowHeight } from './documentTable'
import { effectiveTableColumnWidths } from './documentTable'
import { centimetersToPixels } from './tableColumnLayout'
import { readTableColumns, TABLE_EDGE_HIT_DISTANCE, visibleTableBounds } from './tableGeometry'
import {
  cellAtPosition, resizeAdjacentColumns, resizeTableColumnsFromPixels, rowAtTableY, type ColumnResizeTarget,
} from './tableRuler'

const props = defineProps<{ editor: Editor }>()
const emit = defineEmits<{
  columnResizeStart: [target: ColumnResizeTarget]
  columnResizePreview: [offset: number]
  columnResizeEnd: []
}>()

type Axis = 'column' | 'row'
type Border = { axis: Axis; index: number; coordinate: number; distance: number }
type DragOrigin = {
  pointerId: number
  pointerStart: number
  borderStart: number
  tableNode: ProseMirrorNode
  tablePos: number
  bounds: NonNullable<ReturnType<typeof visibleTableBounds>>
}
type Drag = DragOrigin & (
  | { axis: 'column'; index: number; widths: number[] }
  | { axis: 'row'; rowPos: number; height: number; minimumHeight: number }
)

const hitDistance = 4
const guideStyle = shallowRef<Record<string, string> | null>(null)
let root: HTMLElement | null = null
let drag: Drag | null = null

const borderAtPointer = (event: PointerEvent) => {
  const target = event.target
  const cell = target instanceof Element ? target.closest<HTMLTableCellElement>('td, th') : null
  const element = cell?.closest<HTMLTableElement>('table[data-document-table]')
  if (!cell || !element || !root?.contains(element)) return null

  const box = cell.getBoundingClientRect()
  const { clientX: x, clientY: y } = event
  if (Math.min(Math.abs(x - box.left), Math.abs(x - box.right), Math.abs(y - box.top), Math.abs(y - box.bottom)) > hitDistance) {
    return null
  }
  const tableBox = element.getBoundingClientRect()
  if (Math.abs(x - tableBox.left) <= TABLE_EDGE_HIT_DISTANCE || Math.abs(y - tableBox.top) <= TABLE_EDGE_HIT_DISTANCE) {
    return null
  }

  const { state, view } = props.editor
  const position = state.doc.resolve(view.posAtDOM(cell, 0))
  const table = findParentNodeClosestToPos(position, node => node.type.spec.tableRole === 'table')
  const cellNode = cellAtPosition(position)
  if (!table || !cellNode) return null

  const map = TableMap.get(table.node)
  const rect = map.findCell(cellNode.pos - table.start)
  const borders = [
    { axis: 'column', index: rect.left, coordinate: box.left, distance: Math.abs(x - box.left) },
    { axis: 'column', index: rect.right, coordinate: box.right, distance: Math.abs(x - box.right) },
    { axis: 'row', index: rect.top, coordinate: box.top, distance: Math.abs(y - box.top) },
    { axis: 'row', index: rect.bottom, coordinate: box.bottom, distance: Math.abs(y - box.bottom) },
  ] satisfies Border[]
  const border = borders
    .filter(edge => edge.index > 0 && edge.index < (edge.axis === 'column' ? map.width : map.height)
      && edge.distance <= hitDistance)
    .sort((a, b) => a.distance - b.distance)[0]
  return border ? { border, element, table, map, rect } : null
}

const minimumRowHeight = (table: HTMLTableElement, index: number, height: number, row: ProseMirrorNode) => {
  const canvas = table.closest('.word-editor-canvas')
  if (!canvas || readTableRowHeight(row.attrs.height) === null) return Math.max(1, height)

  // Measure this table once without the edited row's height, leaving the editor DOM untouched.
  const measure = document.createElement('div')
  measure.className = 'word-pagination-measure'
  measure.setAttribute('aria-hidden', 'true')
  measure.style.width = `${table.getBoundingClientRect().width}px`
  measure.style.overflowWrap = getComputedStyle(table).overflowWrap
  const copy = table.cloneNode(true) as HTMLTableElement
  copy.style.width = '100%'
  copy.style.marginLeft = '0'
  copy.rows[index]?.style.removeProperty('height')
  measure.append(copy)
  canvas.append(measure)
  try {
    return Math.max(1, copy.rows[index]?.getBoundingClientRect().height ?? height)
  } finally {
    measure.remove()
  }
}

const setCursor = (axis?: Axis) => {
  if (!root) return
  if (!axis) {
    delete root.dataset.tableResizeAxis
  } else if (root.dataset.tableResizeAxis !== axis) {
    root.dataset.tableResizeAxis = axis
  }
}

const stopDrag = () => {
  const active = drag
  drag = null
  guideStyle.value = null
  setCursor()
  if (active?.axis === 'column') emit('columnResizeEnd')
  if (active && root?.hasPointerCapture(active.pointerId)) root.releasePointerCapture(active.pointerId)
}

const columnWidthsAt = (active: Extract<Drag, { axis: 'column' }>, event: PointerEvent) =>
  resizeAdjacentColumns(active.widths, active.index, event.clientX - active.pointerStart)

const rowHeightAt = (active: Extract<Drag, { axis: 'row' }>, event: PointerEvent) =>
  event.clientY === active.pointerStart ? active.height
    : Math.max(active.minimumHeight, Math.round(active.height + event.clientY - active.pointerStart))

const drawGuide = (active: Drag, event: PointerEvent) => {
  const { bounds } = active
  if (active.axis === 'column') {
    const offset = columnWidthsAt(active, event)[active.index - 1]! - active.widths[active.index - 1]!
    emit('columnResizePreview', offset)
    guideStyle.value = {
      left: `${active.borderStart + offset}px`,
      top: `${bounds.top}px`,
      width: '1px',
      height: `${bounds.bottom - bounds.top}px`,
    }
  } else {
    guideStyle.value = {
      left: `${bounds.left}px`,
      top: `${active.borderStart + rowHeightAt(active, event) - active.height}px`,
      width: `${bounds.right - bounds.left}px`,
      height: '1px',
    }
  }
}

const startDrag = (event: PointerEvent) => {
  if (!root || drag || event.button !== 0 || event.pointerType === 'touch') return
  const hit = borderAtPointer(event)
  if (!hit) return
  const { border, element, table, map, rect } = hit
  const bounds = visibleTableBounds(element)
  if (!bounds) return

  const origin: DragOrigin = {
    pointerId: event.pointerId,
    pointerStart: border.axis === 'column' ? event.clientX : event.clientY,
    borderStart: border.coordinate,
    tablePos: table.pos,
    tableNode: table.node,
    bounds,
  }
  if (border.axis === 'column') {
    const measured = readTableColumns(element, map.width)
    if (!measured) return
    drag = {
      ...origin, borderStart: measured.edges[border.index]!, axis: 'column', index: border.index,
      widths: effectiveTableColumnWidths(table.node).map(centimetersToPixels),
    }
  } else {
    const index = border.index - 1
    const row = table.node.child(index)
    const rowElement = element.rows[index]
    if (!rowElement) return
    const height = rowElement.getBoundingClientRect().height
    let rowPos = table.start
    for (let before = 0; before < index; before++) rowPos += table.node.child(before).nodeSize
    drag = { ...origin, axis: 'row', rowPos, height, minimumHeight: minimumRowHeight(element, index, height, row) }
  }
  event.preventDefault()
  root.setPointerCapture(event.pointerId)
  setCursor(drag.axis)
  if (drag.axis === 'column') {
    emit('columnResizeStart', { tablePos: table.pos, row: rowAtTableY(element, rect, event.clientY), index: border.index })
  }
  drawGuide(drag, event)
}

const movePointer = (event: PointerEvent) => {
  if (drag) {
    if (drag.pointerId === event.pointerId) drawGuide(drag, event)
    return
  }
  setCursor(event.buttons || event.pointerType === 'touch' ? undefined : borderAtPointer(event)?.border.axis)
}

const finishDrag = (event: PointerEvent) => {
  const active = drag
  if (!active || active.pointerId !== event.pointerId) return
  stopDrag()
  const { state, view } = props.editor
  if (state.doc.nodeAt(active.tablePos) !== active.tableNode) return
  if (active.axis === 'column') {
    const widths = columnWidthsAt(active, event)
    if (widths[active.index - 1] === active.widths[active.index - 1]) return
    const transaction = resizeTableColumnsFromPixels(state, active.tablePos, active.tableNode, widths)
    if (transaction) view.dispatch(closeHistory(transaction))
  } else {
    const height = rowHeightAt(active, event)
    if (Math.abs(height - active.height) < 0.5) return
    view.dispatch(closeHistory(state.tr.setNodeAttribute(active.rowPos, 'height', height)))
  }
}

const cancelPointer = (event: PointerEvent) => {
  if (drag?.pointerId === event.pointerId) stopDrag()
}

const leaveTable = () => {
  if (!drag) setCursor()
}

const cancelOnEscape = (event: KeyboardEvent) => {
  if (!drag || event.key !== 'Escape') return
  event.preventDefault()
  stopDrag()
}

const onDocumentChange = ({ transaction }: { transaction: Transaction }) => {
  if (transaction.docChanged) stopDrag()
}

onMounted(() => {
  root = props.editor.view.dom
  root.addEventListener('pointerdown', startDrag, true)
  root.addEventListener('pointermove', movePointer)
  root.addEventListener('pointerup', finishDrag)
  root.addEventListener('pointercancel', cancelPointer)
  root.addEventListener('lostpointercapture', cancelPointer)
  root.addEventListener('pointerleave', leaveTable)
  window.addEventListener('keydown', cancelOnEscape)
  window.addEventListener('scroll', stopDrag, true)
  window.addEventListener('resize', stopDrag)
  window.addEventListener('blur', stopDrag)
  props.editor.on('transaction', onDocumentChange)
})

onBeforeUnmount(() => {
  stopDrag()
  root?.removeEventListener('pointerdown', startDrag, true)
  root?.removeEventListener('pointermove', movePointer)
  root?.removeEventListener('pointerup', finishDrag)
  root?.removeEventListener('pointercancel', cancelPointer)
  root?.removeEventListener('lostpointercapture', cancelPointer)
  root?.removeEventListener('pointerleave', leaveTable)
  window.removeEventListener('keydown', cancelOnEscape)
  window.removeEventListener('scroll', stopDrag, true)
  window.removeEventListener('resize', stopDrag)
  window.removeEventListener('blur', stopDrag)
  props.editor.off('transaction', onDocumentChange)
  root = null
})
</script>

<template>
  <Teleport to="body">
    <span v-if="guideStyle" class="word-table-resize-guide" :style="guideStyle" aria-hidden="true" />
  </Teleport>
</template>

<style>
[data-document-root][data-table-resize-axis="column"] {
  cursor: col-resize;
}

[data-document-root][data-table-resize-axis="row"] {
  cursor: row-resize;
}

.word-table-resize-guide {
  position: fixed;
  z-index: 16;
  background: #4d79b1;
  pointer-events: none;
}

@media print {
  .word-table-resize-guide {
    display: none;
  }
}
</style>
