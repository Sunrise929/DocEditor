import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const tableBorderStyles = ['solid', 'dashed', 'double'] as const
export type TableBorderStyle = (typeof tableBorderStyles)[number]

const outside = ['top', 'right', 'bottom', 'left'] as const
const inside = ['horizontal', 'vertical'] as const
const edges = [...outside, ...inside]
type BorderEdge = (typeof edges)[number]

export const tableBorderScopes = {
  all: edges,
  outside,
  inside,
  horizontal: ['horizontal'],
  vertical: ['vertical'],
  top: ['top'],
  bottom: ['bottom'],
  left: ['left'],
  right: ['right'],
} as const satisfies Record<string, readonly BorderEdge[]>

export type TableBorders = {
  lines: Partial<Record<BorderEdge, TableBorderStyle>>
}

export type TableBorderChange = 'none' | {
  scope: keyof typeof tableBorderScopes
  style: TableBorderStyle
}

export const defaultTableBorders: TableBorders = { lines: {} }
const normalizedBorders = new WeakMap<object, TableBorders>()

export const readTableBorders = (value: unknown): TableBorders => {
  if (!value || typeof value !== 'object' || value === defaultTableBorders) return defaultTableBorders
  const normalized = normalizedBorders.get(value)
  if (normalized) return normalized
  const attrs = value as Partial<TableBorders>
  const lines: TableBorders['lines'] = {}
  for (const edge of edges) {
    const style = attrs.lines?.[edge]
    if (style && tableBorderStyles.includes(style)) lines[edge] = style
  }
  const borders = { lines }
  normalizedBorders.set(value, borders)
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

export const changeTableBorders = (current: TableBorders, change: TableBorderChange): TableBorders => {
  if (change === 'none') return defaultTableBorders
  const affected = tableBorderScopes[change.scope]
  const remove = affected.every(edge => current.lines[edge] === change.style)
  const lines = { ...current.lines }
  for (const edge of affected) {
    if (remove) delete lines[edge]
    else lines[edge] = change.style
  }
  return { lines }
}

export const tableBorderCss = (value: unknown) => {
  const { lines } = readTableBorders(value)
  if (!Object.keys(lines).length) return {}
  return Object.fromEntries(edges.map(edge => {
    const line = lines[edge]
    const width = line === 'double' ? 3 : 1
    const color = line ? '#6b7280' : 'transparent'
    return [`--word-table-border-${edge}`, `${width}px ${line ?? 'solid'} ${color}`]
  }))
}

const tablePerimeter = (table: ProseMirrorNode, position: number, decorations: Decoration[]) => {
  const { lines } = readTableBorders(table.attrs.borders)
  const horizontal = lines.top !== lines.horizontal || lines.bottom !== lines.horizontal
  const vertical = lines.left !== lines.vertical || lines.right !== lines.vertical
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
      doc.forEach((page, offset) => collectPagePerimeters(page, offset, decorations))
      return DecorationSet.create(doc, decorations)
    },
    apply(tr, previous) {
      if (!tr.docChanged) return previous
      let decorations = previous.map(tr.mapping, tr.doc)

      // Preserve decorations on untouched pages and only inspect changed page trees.
      const unchangedPages = new Map<number, ProseMirrorNode>()
      tr.before.forEach((page, offset) => {
        const mapped = tr.mapping.mapResult(offset)
        if (!mapped.deleted) unchangedPages.set(mapped.pos, page)
      })
      const additions: Decoration[] = []
      tr.doc.forEach((page, offset) => {
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
