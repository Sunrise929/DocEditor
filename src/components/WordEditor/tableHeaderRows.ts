import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

export const readTableHeaderRows = (table: ProseMirrorNode, tableStart: number, top: number, bottom: number) => {
  const positions: number[] = []
  let allHeaders = true
  table.forEach((row, offset, index) => {
    if (index < top || index >= bottom) return
    positions.push(tableStart + offset)
    allHeaders &&= row.attrs.isHeader === true
  })
  return { positions, allHeaders }
}

export const toggleTableHeaderRows = (
  transaction: Transaction, { positions, allHeaders }: ReturnType<typeof readTableHeaderRows>,
) => {
  const isHeader = !allHeaders
  for (const position of positions) {
    const row = transaction.doc.nodeAt(position)
    if (row?.type.name === 'tableRow' && row.attrs.isHeader !== isHeader) {
      transaction.setNodeAttribute(position, 'isHeader', isHeader)
    }
  }
  return transaction
}
