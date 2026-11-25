import { forEachDocumentPage } from './documentSections'
import { Extension, findParentNodeClosestToPos, mergeAttributes, type Attributes, type CommandProps } from '@tiptap/core'
import { Table, TableCell, TableRow, TableView } from '@tiptap/extension-table'
import { isHistoryTransaction } from '@tiptap/pm/history'
import type { DOMOutputSpec, Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, type Command, type Selection } from '@tiptap/pm/state'
import { CellSelection, cellAround, mergeCells, selectedRect, splitCell, TableMap } from '@tiptap/pm/tables'

import { cellLineAttribute } from './cellLines'
import { readTableHeaderRows, toggleTableHeaderRows } from './tableHeaderRows'
import { pageContentWidthCm } from './pageGeometry'
import { COLUMN_WIDTH_TOLERANCE, pixelsToCentimeters, setTableColumnWidths } from './tableColumnLayout'
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

// Each entry is the width in centimeters of one logical column in the cell.
export const readTableColumnWidths = (node: ProseMirrorNode) => {
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

export const effectiveTableColumnWidths = (node: ProseMirrorNode) => {
  const widths = readTableColumnWidths(node)
  const fixed = widths.filter(width => width > 0)
  const fixedWidth = fixed.reduce((sum, width) => sum + width, 0)
  const autoWidth = fixed.length ? fixedWidth / fixed.length : 1
  return widths.map(width => width || autoWidth)
}

// Treat saved column widths as proportions when the page's available width changes.
export const tableColumnFractions = (node: ProseMirrorNode) => {
  const widths = effectiveTableColumnWidths(node)
  const total = widths.reduce((sum, width) => sum + width, 0)
  return widths.map(width => width / total)
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

const normalizeWidths = new PluginKey('tableColumnWidths')

const normalizeTableColumnWidths = () => {
  const checkedPages = new WeakSet<ProseMirrorNode>()
  return new Plugin({
    key: normalizeWidths,
    appendTransaction(transactions, _previous, state) {
      if (!transactions.some(tr => tr.docChanged || tr.getMeta(normalizeWidths))) return null
      const tr = state.tr

      forEachDocumentPage(state.doc, (page, pagePos) => {
        if (page.type.name !== 'page' || checkedPages.has(page)) return
        const pageWidth = pageContentWidthCm(page.attrs)
        page.forEach((table, offset) => {
          if (!isTable(table)) return
          const availableWidth = pageWidth - readTableIndent(table.attrs.indentLeft)
          if (availableWidth <= 0) return

          const stored = readTableColumnWidths(table)
          const total = stored.reduce((sum, width) => sum + width, 0)
          if (Math.abs(total - availableWidth) < COLUMN_WIDTH_TOLERANCE && stored.every(width => width > 0)) return

          const widths = effectiveTableColumnWidths(table)
          const scale = availableWidth / widths.reduce((sum, width) => sum + width, 0)
          setTableColumnWidths(tr, pagePos + 1 + offset, table, widths.map(width => width * scale))
        })
      })
      forEachDocumentPage(tr.doc, page => checkedPages.add(page))
      return tr.docChanged ? tr : null
    },
  })
}

export const DocumentTable = Table.extend({
  addCommands() {
    const inherited = this.parent?.()
    const toggleHeaderRow = () => ({ state, tr, dispatch }: CommandProps) => {
      const { selection } = state
      const cell = cellAround(selection.$head)
      if (!(selection instanceof CellSelection) && !cell) return false

      const rect = selectedRect(state)
      const top = selection instanceof CellSelection ? rect.top : cell!.index(-1)
      const bottom = selection instanceof CellSelection ? rect.bottom : top + 1
      if (dispatch) toggleTableHeaderRows(tr, readTableHeaderRows(rect.table, rect.tableStart, top, bottom))
      return true
    }
    return {
      ...inherited,
      insertTable: (options = {}) => props => {
        const inserted = inherited?.insertTable?.({ ...options, withHeaderRow: false })(props) ?? false
        if (inserted && props.dispatch && options.withHeaderRow !== false) {
          const table = tableAtSelection(props.tr.selection)
          if (table) props.tr.setNodeAttribute(table.start, 'isHeader', true)
        }
        return inserted
      },
      toggleHeaderRow,
      toggleHeader: (type: 'row' | 'column' | 'cell') => type === 'row' ? toggleHeaderRow() : () => false,
      toggleHeaderCell: () => () => false,
      toggleHeaderColumn: () => () => false,
    }
  },

  onCreate(event) {
    this.parent?.(event)
    const { state, view } = this.editor
    view.dispatch(state.tr.setMeta(normalizeWidths, true).setMeta('addToHistory', false))
  },

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
    return [...(this.parent?.() ?? []), normalizeTableColumnWidths(), tableBorderPlugin()]
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

const parseColumnWidths = (value: string | null) => {
  if (!value) return null
  const widths = value.split(',').map(Number)
  return widths.every(width => Number.isFinite(width) && width >= 0) ? widths : null
}

const documentCellAttributes = (attributes: Attributes = {}): Attributes => ({
  ...attributes,
  cellLine: cellLineAttribute,
  verticalAlign: alignmentAttribute('verticalAlign', 'vertical-align', verticalAlignments, 'top'),
  textAlign: alignmentAttribute('textAlign', 'text-align', horizontalAlignments, 'left'),
  colwidth: {
    ...attributes.colwidth,
    parseHTML: (element: HTMLElement) => {
      const widthsCm = parseColumnWidths(element.getAttribute('data-colwidth-cm'))
      if (widthsCm) return widthsCm

      const legacyWidths = parseColumnWidths(element.getAttribute('colwidth'))
        ?? parseColumnWidths(element.getAttribute('data-colwidth'))
        ?? attributes.colwidth?.parseHTML?.(element)
      return Array.isArray(legacyWidths) ? legacyWidths.map(pixelsToCentimeters) : null
    },
    renderHTML: attrs => attrs.colwidth ? { 'data-colwidth-cm': attrs.colwidth.join(',') } : {},
  },
})

export const DocumentTableCell = TableCell.extend({
  addAttributes() {
    return documentCellAttributes(this.parent?.())
  },
})

export const DocumentTableRow = TableRow.extend({
  content: 'tableCell*',

  addAttributes() {
    return {
      ...this.parent?.(),
      isHeader: {
        default: false,
        parseHTML: element => element.getAttribute('data-table-header') === 'true',
        renderHTML: attrs => attrs.isHeader === true ? {
          'data-table-header': 'true',
          style: 'background-color: #edf3fa; font-weight: 700',
        } : {},
      },
    }
  },
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
  const widths = readTableColumnWidths(table.node).slice(left, right)
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
