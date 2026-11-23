import { Extension, getMarkRange, Mark } from '@tiptap/core'
import type { Mark as ProseMirrorMark, MarkType, ResolvedPos } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'

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

export const readSelectionFontSize = (state: EditorState) => {
  const { selection, schema } = state
  const type = schema.marks.textStyle
  const $pos = selection.$from
  const mark = type && (selection.empty
    ? cursorTextStyle($pos, type)
    : type.isInSet($pos.nodeAfter?.marks ?? []))
  return parseFontSize(mark?.attrs.fontSize) ?? parseFontSize($pos.parent.attrs.fontSize)
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
      types: ['paragraph', 'heading'],
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
