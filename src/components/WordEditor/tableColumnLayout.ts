import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'

export type TableColumnLayout = {
  indentLeft: number
  widths: number[]
}

export type TableColumnSettings = {
  layout: TableColumnLayout
  availableWidth: number
  subjectIndex: number | null
}

export const MIN_SUBJECT_WIDTH = 0.2
export const COLUMN_WIDTH_TOLERANCE = 1e-9
const pixelsPerCentimeter = 96 / 2.54
export const centimetersToPixels = (cm: number) => cm * pixelsPerCentimeter
export const pixelsToCentimeters = (px: number) => px / pixelsPerCentimeter

export const setTableColumnWidths = (
  tr: Transaction, tablePos: number, table: ProseMirrorNode, widths: readonly number[],
) => {
  const map = TableMap.get(table)
  if (widths.length !== map.width) return

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
}

export const balanceColumnLayout = (
  layout: TableColumnLayout, availableWidth: number, balanceIndex: number,
): TableColumnLayout => {
  const widths = [...layout.widths]
  const used = widths.reduce((total, width, index) => index === balanceIndex ? total : total + width, 0)
  const remainder = availableWidth - layout.indentLeft - used
  widths[balanceIndex] = Math.abs(remainder - MIN_SUBJECT_WIDTH) < COLUMN_WIDTH_TOLERANCE
    ? MIN_SUBJECT_WIDTH : remainder
  return { ...layout, widths }
}
