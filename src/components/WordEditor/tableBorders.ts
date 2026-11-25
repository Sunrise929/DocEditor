import { forEachDocumentPage } from './documentSections'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const tableBorderStyles = ['solid', 'dotted', 'dashed', 'double'] as const
export type TableBorderStyle = (typeof tableBorderStyles)[number]

const outside = ['top', 'right', 'bottom', 'left'] as const
const inside = ['horizontal', 'vertical'] as const
export const tableBorderEdges = [...outside, ...inside]
export type TableBorderEdge = (typeof tableBorderEdges)[number]

export const tableBorderScopes = { outside, inside }

export type TableBorderLine = {
  style: TableBorderStyle
  width: number
  color: string
}

export type TableBorders = {
  lines: Partial<Record<TableBorderEdge, TableBorderLine>>
}

export const defaultTableBorders: TableBorders = { lines: {} }
const normalizedBorders = new WeakMap<object, TableBorders>()

const readBorderLine = (value: unknown): TableBorderLine | undefined => {
  const line = typeof value === 'string' ? { style: value } : value
  if (!line || typeof line !== 'object') return
  const { style, width, color } = line as Partial<TableBorderLine>
  if (!style || !tableBorderStyles.includes(style)) return
  return {
    style,
    width: style === 'double' ? 3 : style === 'solid' && width && [1, 2, 3, 4].includes(width) ? width : 1,
    color: typeof color === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color) ? color.toLowerCase() : '#6b7280',
  }
}

export const readTableBorders = (value: unknown): TableBorders => {
  if (!value || typeof value !== 'object' || value === defaultTableBorders) return defaultTableBorders
  const normalized = normalizedBorders.get(value)
  if (normalized) return normalized
  const attrs = value as { lines?: Partial<Record<TableBorderEdge, unknown>> }
  const lines: TableBorders['lines'] = {}
  for (const edge of tableBorderEdges) {
    const line = readBorderLine(attrs.lines?.[edge])
    if (line) lines[edge] = line
  }
  const borders = { lines }
  normalizedBorders.set(value, borders)
  normalizedBorders.set(borders, borders)
  return borders
}

export const parseTableBorders = (value: string | null) => {
  if (!value) return defaultTableBorders
  try {
    return readTableBorders(JSON.parse(value))
  } catch {
    return defaultTableBorders
  }
}

const sameLine = (first?: TableBorderLine, second?: TableBorderLine) =>
  first?.style === second?.style && first?.width === second?.width && first?.color === second?.color

export const sameTableBorders = (first: TableBorders, second: TableBorders) =>
  tableBorderEdges.every(edge => sameLine(first.lines[edge], second.lines[edge]))

export const tableBorderLineCss = (line: TableBorderLine) => `${line.width}px ${line.style} ${line.color}`

export const tableBorderCss = (value: unknown) => {
  const { lines } = readTableBorders(value)
  const unset = Object.keys(lines).length
    ? '1px solid transparent'
    : '1px dotted var(--word-table-gridline-color, transparent)'
  return Object.fromEntries(tableBorderEdges.map(edge => {
    const line = lines[edge]
    return [`--word-table-border-${edge}`, line ? tableBorderLineCss(line) : unset]
  }))
}

const tablePerimeter = (table: ProseMirrorNode, position: number, decorations: Decoration[]) => {
  const { lines } = readTableBorders(table.attrs.borders)
  const horizontal = !sameLine(lines.top, lines.horizontal) || !sameLine(lines.bottom, lines.horizontal)
  const vertical = !sameLine(lines.left, lines.vertical) || !sameLine(lines.right, lines.vertical)
  if (!horizontal && !vertical) return

  const map = TableMap.get(table)
  const perimeter = new Map<number, Set<string>>()
  const addEdge = (index: number, edge: (typeof outside)[number]) => {
    const offset = map.map[index]
    if (!offset) return
    let sides = perimeter.get(offset)
    if (!sides) perimeter.set(offset, sides = new Set())
    sides.add(edge)
  }

  if (horizontal) {
    for (let column = 0; column < map.width; column++) {
      addEdge(column, 'top')
      addEdge((map.height - 1) * map.width + column, 'bottom')
    }
  }
  if (vertical) {
    for (let row = 0; row < map.height; row++) {
      addEdge(row * map.width, 'left')
      addEdge((row + 1) * map.width - 1, 'right')
    }
  }
  if (!perimeter.size) return

  table.forEach((row, rowOffset) => {
    row.forEach((cell, cellOffset) => {
      const offset = rowOffset + 1 + cellOffset
      const sides = perimeter.get(offset)
      if (!sides) return
      const from = position + 1 + offset
      decorations.push(Decoration.node(from, from + cell.nodeSize, { 'data-table-perimeter': [...sides].join(' ') }))
    })
  })
}

const collectPagePerimeters = (page: ProseMirrorNode, offset: number, decorations: Decoration[]) => {
  page.descendants((node, position) => {
    if (node.type.name === 'table') tablePerimeter(node, offset + 1 + position, decorations)
    return !node.isTextblock
  })
}

export const tableBorderPlugin = () => new Plugin<DecorationSet>({
  state: {
    init(_, { doc }) {
      const decorations: Decoration[] = []
      forEachDocumentPage(doc, (page, offset) => collectPagePerimeters(page, offset, decorations))
      return DecorationSet.create(doc, decorations)
    },
    apply(tr, previous) {
      if (!tr.docChanged) return previous
      let decorations = previous.map(tr.mapping, tr.doc)

      // Preserve decorations on untouched pages and only inspect changed page trees.
      const unchangedPages = new Map<number, ProseMirrorNode>()
      forEachDocumentPage(tr.before, (page, offset) => {
        const mapped = tr.mapping.mapResult(offset)
        if (!mapped.deleted) unchangedPages.set(mapped.pos, page)
      })
      const additions: Decoration[] = []
      forEachDocumentPage(tr.doc, (page, offset) => {
        if (unchangedPages.get(offset) === page) return
        decorations = decorations.remove(decorations.find(offset + 1, offset + page.nodeSize - 1))
        collectPagePerimeters(page, offset, additions)
      })
      return decorations.add(tr.doc, additions)
    },
  },
  props: {
    decorations(state) {
      return this.getState(state)
    },
  },
})
