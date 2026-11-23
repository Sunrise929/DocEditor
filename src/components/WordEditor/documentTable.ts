import { Extension, findParentNodeClosestToPos } from '@tiptap/core'
import { isHistoryTransaction } from '@tiptap/pm/history'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, type EditorState, type Selection } from '@tiptap/pm/state'

const isTable = (node: ProseMirrorNode) => node.type.name === 'table'

export const tableAtSelection = (selection: Selection) => {
  if (selection instanceof NodeSelection && isTable(selection.node)) {
    return { node: selection.node, start: selection.from + 1 }
  }
  return findParentNodeClosestToPos(selection.$head, isTable)
}

export const hasHeaderRow = (table: ProseMirrorNode) =>
  table.firstChild?.children.every(cell => cell.type.spec.tableRole === 'header_cell') ?? false

export const toggleFirstRowHeader = (state: EditorState) => {
  const table = tableAtSelection(state.selection)
  const row = table?.node.firstChild
  if (!table || !row) return null

  const target = state.schema.nodes[hasHeaderRow(table.node) ? 'tableCell' : 'tableHeader']
  if (!target) return null

  const transaction = state.tr
  row.forEach((cell, offset) => {
    if (cell.type !== target) transaction.setNodeMarkup(table.start + 1 + offset, target, cell.attrs, cell.marks)
  })
  return transaction
}

type TableCounts = { tables: number; nested: number }

export const PreventNestedTables = Extension.create({
  name: 'preventNestedTables',

  addProseMirrorPlugins() {
    const countsByNode = new WeakMap<ProseMirrorNode, TableCounts>()

    // Reuse counts for unchanged subtrees. Existing nested tables can still be
    // edited or removed while new transactions cannot introduce more of them.
    const countTables = (node: ProseMirrorNode): TableCounts => {
      const cached = countsByNode.get(node)
      if (cached) return cached

      const table = isTable(node)
      const counts = { tables: table ? 1 : 0, nested: 0 }
      node.forEach(child => {
        const { tables, nested } = countTables(child)
        counts.tables += tables
        counts.nested += table ? tables : nested
      })
      countsByNode.set(node, counts)
      return counts
    }

    return [new Plugin({
      filterTransaction: (transaction, state) =>
        !transaction.docChanged || isHistoryTransaction(transaction)
        || countTables(transaction.doc).nested <= countTables(state.doc).nested,
    })]
  },
})
