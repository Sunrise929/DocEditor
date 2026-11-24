import { Extension, findParentNodeClosestToPos, mergeAttributes, type Attributes } from '@tiptap/core'
import { Table, TableCell, TableHeader, TableView } from '@tiptap/extension-table'
import { isHistoryTransaction } from '@tiptap/pm/history'
import type { DOMOutputSpec, Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, type Command, type EditorState, type Selection } from '@tiptap/pm/state'
import { CellSelection, mergeCells, splitCell, TableMap } from '@tiptap/pm/tables'

import { defaultTableBorders, parseTableBorders, readTableBorders, tableBorderCss, tableBorderPlugin } from './tableBorders'

export const MIN_TABLE_COLUMN_WIDTH = 18

export const readTableIndent = (value: unknown) => {
  const indent = Number(value)
  return Number.isFinite(indent) ? Math.max(0, indent) : 0
}

export const readTableRowHeight = (value: unknown) => {
  const height = Number(value)
  return Number.isFinite(height) && height > 0 ? height : null
}

const tableLayout = (node: ProseMirrorNode) => {
  const indent = `min(${readTableIndent(node.attrs.indentLeft)}cm, 100%)`
  return {
    'table-layout': 'fixed',
    'margin-left': indent,
    width: `calc(100% - ${indent})`,
    'min-width': '0',
    ...tableBorderCss(node.attrs.borders),
  }
}

const tableColumnWidths = (node: ProseMirrorNode) => {
  const widths: number[] = []
  node.firstChild?.forEach(cell => {
    const colwidth = cell.attrs.colwidth as number[] | null
    for (let index = 0; index < cell.attrs.colspan; index++) {
      const width = colwidth?.[index] ?? 0
      widths.push(Number.isFinite(width) && width > 0 ? width : 0)
    }
  })
  return widths
}

// Treat saved column widths as proportions when the page's available width changes.
export const tableColumnFractions = (node: ProseMirrorNode) => {
  const widths = tableColumnWidths(node)
  const fixed = widths.filter(width => width > 0)
  const fixedWidth = fixed.reduce((sum, width) => sum + width, 0)
  const autoWidth = fixed.length ? fixedWidth / fixed.length : 1
  const totalWidth = fixedWidth + (widths.length - fixed.length) * autoWidth
  return widths.map(width => (width || autoWidth) / totalWidth)
}

class DocumentTableView extends TableView {
  constructor(...args: ConstructorParameters<typeof TableView>) {
    super(...args)
    this.applyLayout()
  }

  update(node: ProseMirrorNode) {
    if (!super.update(node)) return false
    this.applyLayout()
    return true
  }

  private applyLayout() {
    for (const [name, value] of Object.entries(tableLayout(this.node))) {
      this.table.style.setProperty(name, value)
    }
    tableColumnFractions(this.node).forEach((fraction, index) => {
      const col = this.colgroup.children[index] as HTMLTableColElement
      col.style.width = `${fraction * 100}%`
      col.style.minWidth = ''
    })
  }
}

export const DocumentTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      borders: {
        default: defaultTableBorders,
        parseHTML: element => parseTableBorders(element.getAttribute('data-table-borders')),
        renderHTML: attrs => ({ 'data-table-borders': JSON.stringify(readTableBorders(attrs.borders)) }),
      },
      isNumbered: {
        default: false,
        parseHTML: element => element.getAttribute('data-table-numbered') === 'true',
        renderHTML: attrs => attrs.isNumbered === true ? { 'data-table-numbered': 'true' } : {},
      },
      indentLeft: {
        default: 0,
        parseHTML: element => readTableIndent(element.getAttribute('data-table-indent-left')),
        renderHTML: attrs => ({ 'data-table-indent-left': readTableIndent(attrs.indentLeft) }),
      },
    }
  },

  addGlobalAttributes() {
    return [{
      types: ['tableRow'],
      attributes: {
        height: {
          default: null,
          parseHTML: element => readTableRowHeight(element.getAttribute('data-table-row-height')),
          renderHTML: attrs => {
            const height = readTableRowHeight(attrs.height)
            return height === null ? {} : { 'data-table-row-height': height, style: `height: ${height}px` }
          },
        },
      },
    }]
  },

  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), tableBorderPlugin()]
  },

  renderHTML({ node, HTMLAttributes }) {
    const columns = tableColumnFractions(node).map((fraction): DOMOutputSpec =>
      ['col', { style: `width: ${fraction * 100}%` }],
    )
    const style = Object.entries(tableLayout(node)).map(([name, value]) => `${name}: ${value}`).join('; ')
    const table: DOMOutputSpec = [
      'table',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { style }),
      ['colgroup', ...columns],
      ['tbody', 0],
    ]
    return this.options.renderWrapper ? ['div', { class: 'tableWrapper' }, table] : table
  },
}).configure({
  View: DocumentTableView,
  cellMinWidth: MIN_TABLE_COLUMN_WIDTH,
  HTMLAttributes: { 'data-document-table': '' },
})

const verticalAlignments = ['top', 'middle', 'bottom'] as const
const horizontalAlignments = ['left', 'center', 'right'] as const

export type TableCellAlignment = {
  verticalAlign: typeof verticalAlignments[number]
  textAlign: typeof horizontalAlignments[number]
}

export type TableCellAlignmentState = {
  available: boolean
  alignment: TableCellAlignment | null
}

const alignmentAttribute = (key: keyof TableCellAlignment, property: string, allowedValues: readonly string[], fallback: string) => ({
  default: null,
  parseHTML: (element: HTMLElement) => {
    const value = element.style.getPropertyValue(property)
    return allowedValues.includes(value) ? value : null
  },
  renderHTML: (attributes: Record<string, unknown>) => {
    const value = attributes[key]
    const alignment = typeof value === 'string' && allowedValues.includes(value)
      ? value : `var(--word-table-cell-${property}, ${fallback})`
    return { style: `${property}: ${alignment}` }
  },
})

const documentCellAttributes = (attributes: Attributes = {}): Attributes => ({
  ...attributes,
  verticalAlign: alignmentAttribute('verticalAlign', 'vertical-align', verticalAlignments, 'top'),
  textAlign: alignmentAttribute('textAlign', 'text-align', horizontalAlignments, 'left'),
  colwidth: {
    ...attributes.colwidth,
    parseHTML: (element: HTMLElement) => {
      const widths = element.getAttribute('colwidth')?.split(',').map(Number)
      if (widths?.every(width => Number.isFinite(width) && width >= 0)) return widths
      return attributes.colwidth?.parseHTML?.(element) ?? null
    },
  },
})

export const DocumentTableCell = TableCell.extend({
  addAttributes() {
    return documentCellAttributes(this.parent?.())
  },
})

export const DocumentTableHeader = TableHeader.extend({
  addAttributes() {
    return documentCellAttributes(this.parent?.())
  },
}).configure({
  HTMLAttributes: { style: 'background-color: var(--table-cell-selection, #edf3fa)' },
})

const isTable = (node: ProseMirrorNode) => node.type.name === 'table'

export const tableAtSelection = (selection: Selection) => {
  if (selection instanceof NodeSelection && isTable(selection.node)) {
    return { node: selection.node, start: selection.from + 1 }
  }
  return findParentNodeClosestToPos(selection.$head, isTable)
}

const mergeCellsWithColumnWidths: Command = (state, dispatch) => {
  if (!dispatch) return mergeCells(state)

  const { selection } = state
  const table = tableAtSelection(selection)
  if (!table || !(selection instanceof CellSelection)) return false

  const { left, right } = TableMap.get(table.node).rectBetween(
    selection.$anchorCell.pos - table.start, selection.$headCell.pos - table.start,
  )
  const widths = tableColumnWidths(table.node).slice(left, right)
  return mergeCells(state, transaction => {
    // A merge can remove every cell that stored a column's width.
    if (widths.some(width => width > 0) && transaction.selection instanceof CellSelection) {
      transaction.setNodeAttribute(transaction.selection.$anchorCell.pos, 'colwidth', widths)
    }
    dispatch(transaction)
  })
}

export const tableCellCommands = { merge: mergeCellsWithColumnWidths, split: splitCell }
export type TableCellAction = keyof typeof tableCellCommands

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
