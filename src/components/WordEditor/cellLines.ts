import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model'
import { Plugin, type Selection } from '@tiptap/pm/state'
import { CellSelection, cellAround } from '@tiptap/pm/tables'

const horizontal = (y: string, details = '') =>
  `<line x1="4%" y1="${y}" x2="96%" y2="${y}" ${details}/>`

const drawings = {
  lower: horizontal('78%'),
  upper: horizontal('22%'),
  dashed: horizontal('22%', 'stroke-dasharray="4 3"'),
  dashSolid: horizontal('50%', 'stroke-dasharray="4 3" transform="translate(0,-2)"')
    + horizontal('50%', 'transform="translate(0,2)"'),
  diagonal: '<line x1="96%" y1="8%" x2="4%" y2="92%"/>',
  double: horizontal('50%', 'transform="translate(0,-2)"')
    + horizontal('50%', 'transform="translate(0,2)"'),
}

export type CellLine = keyof typeof drawings
export type CellLineState = { available: boolean; line: CellLine | null; canRemove: boolean }

export const readCellLine = (value: unknown): CellLine | null =>
  typeof value === 'string' && Object.hasOwn(drawings, value) ? value as CellLine : null

export const cellLineImages = Object.fromEntries(Object.entries(drawings).map(([line, strokes]) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><g stroke="#273142" stroke-width="1">${strokes}</g></svg>`
  return [line, `url("data:image/svg+xml,${encodeURIComponent(svg)}")`]
})) as Record<CellLine, string>

export const cellLineAttribute = {
  default: null,
  parseHTML: (element: HTMLElement) => readCellLine(element.getAttribute('data-cell-line')),
  renderHTML: (attrs: Record<string, unknown>) => {
    const line = readCellLine(attrs.cellLine)
    return line ? {
      'data-cell-line': line,
      style: `background-image: ${cellLineImages[line]}; background-size: 100% 100%; background-repeat: no-repeat`,
    } : {}
  },
}

export const isEmptyCell = (cell: ProseMirrorNode) =>
  cell.childCount === 1 && cell.firstChild?.isTextblock === true && cell.firstChild.content.size === 0

const lineAt = (position: ResolvedPos) => readCellLine(cellAround(position)?.nodeAfter?.attrs.cellLine)

const selectionHasLine = (selection: Selection) => {
  if (!(selection instanceof CellSelection)) return Boolean(lineAt(selection.$from) || lineAt(selection.$to))

  let ruled = false
  selection.forEachCell(cell => { ruled ||= Boolean(readCellLine(cell.attrs.cellLine)) })
  return ruled
}

export const ProtectRuledCells = Extension.create({
  name: 'protectRuledCells',

  addProseMirrorPlugins() {
    const invalidByNode = new WeakMap<ProseMirrorNode, boolean>()
    const hasInvalidCell = (node: ProseMirrorNode): boolean => {
      if (node.isTextblock) return false
      const cached = invalidByNode.get(node)
      if (cached !== undefined) return cached
      const invalid = (Boolean(readCellLine(node.attrs.cellLine)) && !isEmptyCell(node))
        || node.children.some(hasInvalidCell)
      invalidByNode.set(node, invalid)
      return invalid
    }

    return [new Plugin({
      filterTransaction: transaction => !transaction.docChanged || !hasInvalidCell(transaction.doc),
      props: {
        handleDOMEvents: {
          beforeinput: (view, event) => {
            if (event.inputType.startsWith('history') || !selectionHasLine(view.state.selection)) return false
            event.preventDefault()
            return true
          },
        },
        handleTextInput: view => selectionHasLine(view.state.selection),
        handlePaste: view => selectionHasLine(view.state.selection),
        handleDrop: (view, event) => {
          const position = view.posAtCoords({ left: event.clientX, top: event.clientY })
          return Boolean(position && lineAt(view.state.doc.resolve(position.pos)))
        },
      },
    })]
  },
})
