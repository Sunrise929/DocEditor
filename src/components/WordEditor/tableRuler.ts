import { findParentNodeClosestToPos } from '@tiptap/core'
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model'
import { CellSelection, TableMap } from '@tiptap/pm/tables'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { MIN_TABLE_COLUMN_WIDTH, readTableIndent, tableAtSelection } from './documentTable'
import { readTableColumns } from './tableGeometry'

export type TableRulerContext = {
  table: ProseMirrorNode
  indentLeft: number
  edges: number[]
  visibleEdges: number[]
  widths: number[]
  pixelsPerMm: number
  cell: { start: number; end: number } | null
}

type TableRulerTarget = { tablePos: number; row: number }
export type ColumnResizeTarget = TableRulerTarget & { index: number }

export const rowAtTableY = (table: HTMLTableElement, rect: { top: number; bottom: number }, y: number) => {
  let row = rect.top
  while (row + 1 < rect.bottom && (table.rows[row + 1]?.getBoundingClientRect().top ?? Infinity) <= y) row++
  return row
}

const isCell = (node: ProseMirrorNode) => {
  const role = node.type.spec.tableRole
  return role === 'cell' || role === 'header_cell'
}

export const cellAtPosition = ($pos: ResolvedPos) =>
  findParentNodeClosestToPos($pos, isCell)

export const cellTextBox = (view: EditorView, position: number) => {
  const element = view.nodeDOM(position)
  if (!(element instanceof HTMLTableCellElement)) return null
  const { left, right } = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  const borderScale = style.borderCollapse === 'collapse' ? 0.5 : 1
  const start = left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth) * borderScale
  const end = right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth) * borderScale
  return { start, end: Math.max(start, end) }
}

export const readTableRuler = (view: EditorView, pageWidth: number, target?: TableRulerTarget) => {
  const { doc, selection } = view.state
  const selectedTable = tableAtSelection(selection)
  const table = target ? { node: doc.nodeAt(target.tablePos), start: target.tablePos + 1 } : selectedTable
  if (table?.node?.type.spec.tableRole !== 'table') return null

  const dom = view.nodeDOM(table.start - 1)
  const element = dom instanceof HTMLTableElement ? dom
    : dom instanceof HTMLElement ? dom.querySelector<HTMLTableElement>(':scope > table') : null
  const page = element?.closest('[data-page]')?.getBoundingClientRect()
  if (!element || !page?.width) return null

  const map = TableMap.get(table.node)
  const columns = readTableColumns(element, map.width)
  if (!columns) return null
  const { edges, widths } = columns
  const pixelsPerMm = page.width / pageWidth
  const mm = (x: number) => (x - page.left) / pixelsPerMm

  const selectedCell = selection instanceof CellSelection
    ? selection.$headCell.pos : cellAtPosition(selection.$head)?.pos
  const cellPosition = selectedTable?.start === table.start && selectedCell !== undefined && selectedCell >= table.start
    ? selectedCell : undefined
  const cell = cellPosition === undefined ? null : cellTextBox(view, cellPosition)
  const cellRect = cellPosition === undefined ? null : map.findCell(cellPosition - table.start)
  const row = target?.row ?? (
    cellRect && cellRect.bottom - cellRect.top > 1 && !(selection instanceof CellSelection)
      ? rowAtTableY(element, cellRect, view.coordsAtPos(selection.head).top)
      : cellRect?.top ?? 0
  )

  const visibleEdges = widths.flatMap((_, column) => {
    const index = row * map.width + column
    return column < map.width - 1 && map.map[index] !== map.map[index + 1] ? [column + 1] : []
  })
  return {
    element,
    context: {
      table: table.node,
      indentLeft: readTableIndent(table.node.attrs.indentLeft),
      edges: edges.map(mm),
      visibleEdges,
      widths,
      pixelsPerMm,
      cell: cell ? { start: mm(cell.start), end: mm(cell.end) } : null,
    } satisfies TableRulerContext,
  }
}

export const resizeAdjacentColumns = (original: readonly number[], index: number, delta: number) => {
  const widths = [...original]
  const left = widths[index - 1]
  const right = widths[index]
  if (left === undefined || right === undefined) return widths

  const minDelta = Math.min(0, MIN_TABLE_COLUMN_WIDTH - left)
  const maxDelta = Math.max(0, right - MIN_TABLE_COLUMN_WIDTH)
  const change = Math.max(minDelta, Math.min(maxDelta, Math.round(delta)))
  widths[index - 1] = left + change
  widths[index] = right - change
  return widths
}

export const resizeTableColumns = (
  state: EditorState,
  tablePos: number,
  originalTable: ProseMirrorNode,
  widths: readonly number[],
) => {
  const table = state.doc.nodeAt(tablePos)
  if (table !== originalTable) return null
  const map = TableMap.get(table)
  if (widths.length !== map.width) return null

  const tr = state.tr
  const firstColumns = new Map<number, number>()
  map.map.forEach((offset, index) => {
    if (!firstColumns.has(offset)) firstColumns.set(offset, index % map.width)
  })
  table.forEach((row, rowOffset) => {
    row.forEach((cell, cellOffset) => {
      const offset = rowOffset + 1 + cellOffset
      const column = firstColumns.get(offset)
      if (column === undefined) return
      const colwidth = widths.slice(column, column + cell.attrs.colspan)
      const previous = cell.attrs.colwidth as number[] | null
      if (previous?.length === colwidth.length && colwidth.every((width, i) => width === previous[i])) return
      tr.setNodeAttribute(tablePos + 1 + offset, 'colwidth', colwidth)
    })
  })
  return tr.docChanged ? tr : null
}
