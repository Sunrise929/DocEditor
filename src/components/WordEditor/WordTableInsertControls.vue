<script setup lang="ts">
import { findParentNodeClosestToPos, type Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { addColumn, addRow, TableMap } from '@tiptap/pm/tables'
import { ElButton } from 'element-plus'
import 'element-plus/es/components/button/style/css'
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { TABLE_EDGE_HIT_DISTANCE as hitDistance, visibleTableBounds } from './tableGeometry'
import { isValidTableSize } from './tableSize'

const props = defineProps<{ editor: Editor }>()

type Axis = 'row' | 'column'
type InsertControl = {
  axis: Axis
  index: number
  coordinate: number
  tableEdge: number
  start: number
  end: number
  tableElement: HTMLTableElement
  tableNode: ProseMirrorNode
  tablePos: number
}

const axes = ['row', 'column'] as const
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

const nearestEdge = (pointer: number, start: number, end: number, firstIndex: number, lastIndex: number) => {
  const before = Math.abs(pointer - start)
  const after = Math.abs(pointer - end)
  if (Math.min(before, after) > hitDistance) return null
  return before <= after ? { index: firstIndex, coordinate: start } : { index: lastIndex, coordinate: end }
}

const canInsertAt = (map: TableMap, axis: Axis) => isValidTableSize({
  rows: map.height + (axis === 'row' ? 1 : 0),
  cols: map.width + (axis === 'column' ? 1 : 0),
})

const cellProbeCoordinate = (pointer: number, start: number, end: number) => {
  const inset = Math.min(2, (end - start) / 2)
  return Math.max(start + inset, Math.min(end - inset, pointer))
}

const controlsAtTable = (event: PointerEvent, tableElement: HTMLTableElement): InsertControl[] => {
  const { clientX: x, clientY: y } = event
  const tableBox = tableElement.getBoundingClientRect()
  const nearLeft = Math.abs(x - tableBox.left) <= hitDistance
    && y >= tableBox.top - hitDistance && y <= tableBox.bottom + hitDistance
  const nearTop = Math.abs(y - tableBox.top) <= hitDistance
    && x >= tableBox.left - hitDistance && x <= tableBox.right + hitDistance
  if (!nearLeft && !nearTop) return []

  const bounds = visibleTableBounds(tableElement, tableBox)
  if (!bounds) return []
  const { left, right, top, bottom, viewportTop } = bounds
  const { state, view } = props.editor

  return axes.flatMap(axis => {
    const row = axis === 'row'
    if (row ? !nearLeft || tableBox.left < left : !nearTop || tableBox.top < top) return []

    // Probe just inside the edge so the table border and the space beside it work too.
    const probeX = cellProbeCoordinate(row ? left : x, left, right)
    const probeY = cellProbeCoordinate(row ? y : top, top, bottom)
    const cell = document.elementsFromPoint(probeX, probeY)
      .map(element => element.closest<HTMLTableCellElement>('td, th'))
      .find(candidate => candidate?.closest('table') === tableElement)
    if (!cell) return []

    const position = state.doc.resolve(view.posAtDOM(cell, 0))
    const table = findParentNodeClosestToPos(position, node => node.type.name === 'table')
    const cellNode = findParentNodeClosestToPos(position, node =>
      node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell',
    )
    if (!table || !cellNode) return []

    const map = TableMap.get(table.node)
    if (!canInsertAt(map, axis)) return []
    const rect = map.findCell(cellNode.pos - table.start)
    const box = cell.getBoundingClientRect()
    const firstIndex = row ? rect.top : rect.left
    const lastIndex = row ? rect.bottom : rect.right
    const start = firstIndex === 0 ? (row ? tableBox.top : tableBox.left) : (row ? box.top : box.left)
    const end = lastIndex === (row ? map.height : map.width)
      ? (row ? tableBox.bottom : tableBox.right)
      : (row ? box.bottom : box.right)
    const edge = nearestEdge(row ? y : x, start, end, firstIndex, lastIndex)
    if (!edge || edge.coordinate < (row ? top : left) || edge.coordinate > (row ? bottom : right)) return []

    return [{
      ...edge,
      axis,
      tableEdge: row ? tableBox.left : tableBox.top,
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
    && along >= control.start - buttonRadius - 2 && along <= control.tableEdge + hitDistance
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

  const { dom } = props.editor.view
  const tableSelector = 'table[data-document-table]'
  const page = target?.closest('[data-page]')
  const hoveredTable = target?.closest<HTMLTableElement>(tableSelector)
  const tables = hoveredTable && dom.contains(hoveredTable) ? [hoveredTable]
    : page && dom.contains(page) ? Array.from(page.querySelectorAll<HTMLTableElement>(tableSelector)) : []
  const found = tables.flatMap(table => controlsAtTable(event, table))
  const next = axes.flatMap(axis => {
    const control = found.find(hint => hint.axis === axis) ?? controls.value.find(hint =>
      hint.axis === axis && hint.tableElement.isConnected
      && (!hoveredTable || hoveredTable === hint.tableElement) && isNearControl(event, hint),
    )
    return control ? [control] : []
  })

  if (next.length === controls.value.length && next.every((control, index) => {
    const previous = controls.value[index]
    return previous?.axis === control.axis && previous.tableNode === control.tableNode
      && previous.index === control.index && previous.coordinate === control.coordinate
      && previous.start === control.start && previous.end === control.end && previous.tableEdge === control.tableEdge
  })) return
  controls.value = next
}

const onPointerMove = (event: PointerEvent) => {
  if (!controls.value.length && !(event.target instanceof Element && event.target.closest('[data-page]'))) return
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
