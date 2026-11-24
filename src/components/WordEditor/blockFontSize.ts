import { Extension, getMarkRange, Mark } from '@tiptap/core'
import type { Mark as ProseMirrorMark, MarkType, Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'

const fontSizeBlockTypes = ['paragraph', 'heading']

export const parseFontSize = (value: unknown): number | null => {
  if (typeof value === 'string') {
    const input = value.trim()
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(input)) return null
    value = Number(input)
  }
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

const readInlineSize = (element: HTMLElement) => {
  const size = element.style.fontSize
  const unit = size.slice(-2)
  if (unit !== 'pt' && unit !== 'px') return null
  const value = parseFontSize(size.slice(0, -2))
  return value === null || unit === 'pt' ? value : value * 0.75
}

export const InlineTextStyle = Mark.create({
  name: 'textStyle',
  addAttributes() {
    return {
      fontSize: {
        default: null,
        parseHTML: readInlineSize,
        renderHTML: attrs => {
          const size = parseFontSize(attrs.fontSize)
          return size === null ? {} : { style: `font-size: ${size}pt` }
        },
      },
    }
  },
  parseHTML() {
    return [{
      tag: 'span[data-text-style], span[style]',
      getAttrs: (element: HTMLElement) =>
        element.hasAttribute('data-text-style') || readInlineSize(element) !== null ? null : false,
    }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, 'data-text-style': '' }, 0]
  },
})

const cursorTextStyle = ($pos: ResolvedPos, type: MarkType) =>
  type.isInSet($pos.nodeBefore?.marks ?? [])

const forEachSelectedCellBlock = (
  selection: CellSelection,
  visit: (block: ProseMirrorNode, position: number) => void,
) => {
  selection.forEachCell((cell, position) => {
    cell.descendants((block, offset) => {
      if (block.type.spec.tableRole === 'table') return false
      if (!fontSizeBlockTypes.includes(block.type.name)) return
      visit(block, position + 1 + offset)
      return false
    })
  })
}

export const readSelectionFontSize = (state: EditorState): { size: number | null; available: boolean } => {
  const { selection, schema } = state
  if (selection instanceof CellSelection) {
    const sizes = new Set<number | null>()
    forEachSelectedCellBlock(selection, block => sizes.add(parseFontSize(block.attrs.fontSize)))
    return {
      size: sizes.size === 1 ? sizes.values().next().value ?? null : null,
      available: sizes.size > 0,
    }
  }
  if (!fontSizeBlockTypes.includes(selection.$head.parent.type.name)) {
    return { size: null, available: false }
  }
  const type = schema.marks.textStyle
  const $pos = selection.$from
  const mark = type && (selection.empty
    ? cursorTextStyle($pos, type)
    : type.isInSet($pos.nodeAfter?.marks ?? []))
  const size = parseFontSize(mark?.attrs.fontSize) ?? parseFontSize($pos.parent.attrs.fontSize)
  return { size, available: true }
}

export const setFontSizeInCells = (state: EditorState, selection: CellSelection, size: number) => {
  const transaction = state.tr
  forEachSelectedCellBlock(selection, (block, position) => {
    if (block.attrs.fontSize !== size) transaction.setNodeAttribute(position, 'fontSize', size)
  })
  return transaction
}

const withoutFontSize = (mark: ProseMirrorMark) => {
  const attrs = { ...mark.attrs, fontSize: null }
  return Object.values(attrs).some(value => value != null) ? mark.type.create(attrs) : null
}

export const setFontSizeAtCursor = (state: EditorState, size: number) => {
  const { selection: { $head }, schema, storedMarks, tr } = state
  const type = schema.marks.textStyle
  const mark = type && cursorTextStyle($head, type)

  if ($head.parent.attrs.fontSize !== size) {
    tr.setNodeAttribute($head.before(), 'fontSize', size)
  }

  if (mark && parseFontSize(mark.attrs.fontSize) !== null) {
    // Look up the range from the preceding node; getMarkRange checks the following node first.
    const anchor = $head.doc.resolve($head.pos - 1)
    const range = getMarkRange(anchor, mark.type, mark.attrs)
    if (range) {
      tr.removeMark(range.from, range.to, mark)
      const remaining = withoutFontSize(mark)
      if (remaining) tr.addMark(range.from, range.to, remaining)
    }
  }

  if (storedMarks) {
    tr.setStoredMarks(storedMarks.flatMap(mark => {
      if (mark.type !== type) return [mark]
      const remaining = withoutFontSize(mark)
      return remaining ? [remaining] : []
    }))
  }
  return tr
}

export const BlockFontSize = Extension.create({
  name: 'blockFontSize',
  addGlobalAttributes() {
    return [{
      types: fontSizeBlockTypes,
      attributes: {
        fontSize: {
          default: null,
          parseHTML: element => parseFontSize(element.getAttribute('data-font-size')),
          renderHTML: attrs => {
            const size = parseFontSize(attrs.fontSize)
            return size === null ? {} : { 'data-font-size': size, style: `font-size: ${size}pt` }
          },
        },
      },
    }]
  },
})
