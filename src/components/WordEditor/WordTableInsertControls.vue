<script setup lang="ts">
import { findParentNodeClosestToPos, type Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { addColumn, addRow, TableMap } from '@tiptap/pm/tables'
import { ElButton } from 'element-plus'
import 'element-plus/es/components/button/style/css'
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { isValidTableSize } from './tableSize'

const props = defineProps<{ editor: Editor }>()

type Axis = 'row' | 'column'
type InsertControl = {
  axis: Axis
  index: number
  coordinate: number
  start: number
  end: number
  tableElement: HTMLTableElement
  tableNode: ProseMirrorNode
  tablePos: number
}

const axes = ['row', 'column'] as const
const hitDistance = 5
const keepDistance = 10
const buttonRadius = 9
const controls = shallowRef<InsertControl[]>([])
let pendingPointer: PointerEvent | undefined
let animationFrame: number | undefined

const clearControls = () => {
  pendingPointer = undefined
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)
  animationFrame = undefined
  if (controls.value.length) controls.value = []
}

const nearestInternalEdge = (
  pointer: number,
  start: number,
  end: number,
  firstIndex: number,
  lastIndex: number,
  count: number,
) => {
  const before = firstIndex > 0 ? Math.abs(pointer - start) : Infinity
  const after = lastIndex < count ? Math.abs(pointer - end) : Infinity
  if (Math.min(before, after) > hitDistance) return null
  return before <= after ? { index: firstIndex, coordinate: start } : { index: lastIndex, coordinate: end }
}

const canInsertAt = (map: TableMap, axis: Axis) => isValidTableSize({
  rows: map.height + (axis === 'row' ? 1 : 0),
  cols: map.width + (axis === 'column' ? 1 : 0),
})

const controlsAtCell = (event: PointerEvent, cell: HTMLTableCellElement, tableElement: HTMLTableElement) => {
  const box = cell.getBoundingClientRect()
  const { clientX: x, clientY: y } = event
  if (Math.min(Math.abs(y - box.top), Math.abs(y - box.bottom), Math.abs(x - box.left), Math.abs(x - box.right)) > hitDistance) {
    return []
  }

  const { state, view } = props.editor
  if (!view.dom.contains(cell)) return []
  const position = state.doc.resolve(view.posAtDOM(cell, 0))
  const table = findParentNodeClosestToPos(position, node => node.type.name === 'table')
  const cellNode = findParentNodeClosestToPos(position, node =>
    node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell',
  )
  const wrapper = tableElement.parentElement
  if (!table || !cellNode || !wrapper) return []

  const map = TableMap.get(table.node)
  const rect = map.findCell(cellNode.pos - table.start)
  const frame = wrapper.getBoundingClientRect()
  const tableBox = tableElement.getBoundingClientRect()
  const canvas = view.dom.closest('.word-editor-canvas')
  const ribbonBottom = canvas ? parseFloat(getComputedStyle(canvas).getPropertyValue('--word-ribbon-bottom')) || 0 : 0
  const horizontalRuler = canvas?.querySelector<HTMLElement>('.word-horizontal-ruler-shell')
  const floatingRibbon = canvas?.parentElement?.querySelector('.word-ribbon-panel.is-floating')
  const viewportTop = Math.max(ribbonBottom + (horizontalRuler?.offsetHeight ?? 0), floatingRibbon?.getBoundingClientRect().bottom ?? 0)
  const left = Math.max(frame.left, tableBox.left, 0)
  const right = Math.min(frame.left + wrapper.clientWidth, tableBox.right, document.documentElement.clientWidth)
  const top = Math.max(frame.top, tableBox.top, viewportTop)
  const bottom = Math.min(frame.top + wrapper.clientHeight, tableBox.bottom, document.documentElement.clientHeight)
  if (left >= right || top >= bottom) return []

  return axes.flatMap(axis => {
    const row = axis === 'row'
    const edge = row
      ? nearestInternalEdge(y, box.top, box.bottom, rect.top, rect.bottom, map.height)
      : nearestInternalEdge(x, box.left, box.right, rect.left, rect.right, map.width)
    if (!edge || !canInsertAt(map, axis)) return []
    if (edge.coordinate < (row ? top : left) || edge.coordinate > (row ? bottom : right)) return []

    return [{
      ...edge,
      axis,
      start: Math.max((row ? 0 : viewportTop) + buttonRadius + 2, (row ? left : top) - buttonRadius - 3),
      end: row ? right : bottom,
      tablePos: table.pos,
      tableNode: table.node,
      tableElement,
    }]
  })
}

const isNearControl = (event: PointerEvent, control: InsertControl) => {
  const row = control.axis === 'row'
  const along = row ? event.clientX : event.clientY
  const across = row ? event.clientY : event.clientX
  return Math.abs(across - control.coordinate) <= keepDistance
    && along >= control.start - buttonRadius - 2 && along <= control.end + 2
}

const updateControls = () => {
  animationFrame = undefined
  const event = pendingPointer
  pendingPointer = undefined
  if (!event) return

  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('.word-table-insert-button')) return
  if (event.buttons !== 0 || event.pointerType === 'touch') {
    clearControls()
    return
  }

  const cell = target?.closest<HTMLTableCellElement>('td, th')
  const table = cell?.closest<HTMLTableElement>('table[data-document-table]')
  const found = cell && table ? controlsAtCell(event, cell, table) : []
  const next = axes.flatMap(axis => {
    const control = found.find(hint => hint.axis === axis) ?? controls.value.find(hint =>
      hint.axis === axis && hint.tableElement.isConnected
      && (!table || table === hint.tableElement) && isNearControl(event, hint),
    )
    return control ? [control] : []
  })

  if (next.length === controls.value.length && next.every((control, index) => {
    const previous = controls.value[index]
    return previous?.axis === control.axis && previous.tableNode === control.tableNode
      && previous.index === control.index && previous.coordinate === control.coordinate
      && previous.start === control.start && previous.end === control.end
  })) return
  controls.value = next
}

const onPointerMove = (event: PointerEvent) => {
  if (!controls.value.length && !(event.target instanceof Element && event.target.closest('td, th'))) return
  pendingPointer = event
  if (animationFrame === undefined) animationFrame = requestAnimationFrame(updateControls)
}

const onDocumentChange = ({ transaction }: { transaction: Transaction }) => {
  if (transaction.docChanged) clearControls()
}

const onPointerOut = (event: PointerEvent) => {
  if (event.relatedTarget === null) clearControls()
}

const insert = (control: InsertControl) => {
  const { state, view } = props.editor
  const table = state.doc.nodeAt(control.tablePos)
  if (!table || table !== control.tableNode || !control.tableElement.isConnected) {
    clearControls()
    return
  }

  const map = TableMap.get(table)
  if (!canInsertAt(map, control.axis)) return
  const context = { table, map, tableStart: control.tablePos + 1, left: 0, top: 0, right: map.width, bottom: map.height }
  const transaction = closeHistory(state.tr)
  if (control.axis === 'row') addRow(transaction, context, control.index)
  else addColumn(transaction, context, control.index)
  clearControls()
  view.dispatch(transaction)
  view.focus()
}

const buttonStyle = (control: InsertControl) => ({
  left: `${control.axis === 'row' ? control.start : control.coordinate}px`,
  top: `${control.axis === 'row' ? control.coordinate : control.start}px`,
})

const guideStyle = (control: InsertControl) => {
  const start = control.start + buttonRadius
  const length = Math.max(0, control.end - start)
  return control.axis === 'row'
    ? { left: `${start}px`, top: `${control.coordinate}px`, width: `${length}px` }
    : { left: `${control.coordinate}px`, top: `${start}px`, height: `${length}px` }
}

onMounted(() => {
  document.addEventListener('pointermove', onPointerMove, { passive: true })
  document.addEventListener('pointerout', onPointerOut)
  window.addEventListener('scroll', clearControls, true)
  window.addEventListener('resize', clearControls)
  window.addEventListener('blur', clearControls)
  props.editor.on('transaction', onDocumentChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('pointerout', onPointerOut)
  window.removeEventListener('scroll', clearControls, true)
  window.removeEventListener('resize', clearControls)
  window.removeEventListener('blur', clearControls)
  props.editor.off('transaction', onDocumentChange)
  clearControls()
})
</script>

<template>
  <Teleport to="body">
    <template v-for="control in controls" :key="control.axis">
      <span
        class="word-table-insert-guide"
        :class="'is-' + control.axis"
        :style="guideStyle(control)"
        aria-hidden="true"
      />
      <ElButton
        circle
        class="word-table-insert-button"
        :class="'is-' + control.axis"
        :style="buttonStyle(control)"
        :aria-label="control.axis === 'row' ? '在此插入一行' : '在此插入一列'"
        @mousedown.prevent
        @click.stop="insert(control)"
      >
        <span class="word-table-insert-plus" aria-hidden="true" />
      </ElButton>
    </template>
  </Teleport>
</template>

<style src="./WordTableInsertControls.css"></style>
