import type { EditorState } from '@tiptap/pm/state'
import { CellSelection, selectedRect } from '@tiptap/pm/tables'

export type RowSwapDirection = 'up' | 'down'

export const readRowSwapOptions = ({ map, top, bottom }: ReturnType<typeof selectedRect>) => {
  const boundaries = [0]
  for (let row = 1; row < map.height; row++) {
    const before = (row - 1) * map.width
    const after = row * map.width
    // A shared cell on either side means this boundary cuts through a rowspan.
    let open = true
    for (let col = 0; col < map.width; col++) {
      if (map.map[before + col] === map.map[after + col]) {
        open = false
        break
      }
    }
    if (open) boundaries.push(row)
  }
  boundaries.push(map.height)

  const firstRow = boundaries[boundaries.findIndex(row => row > top) - 1]!
  const endRow = boundaries.find(row => row >= bottom)!
  const length = endRow - firstRow
  const validBoundaries = new Set(boundaries)
  const fitsAt = (row: number) => validBoundaries.has(row + length)
  return {
    firstRow,
    endRow,
    up: boundaries.filter(row => row + length <= firstRow && fitsAt(row))
      .reverse().map(row => firstRow - row),
    down: boundaries.filter(row => row >= endRow && fitsAt(row))
      .map(row => row - firstRow),
  }
}

export const swapSelectedRows = (state: EditorState, direction: RowSwapDirection, distance: number) => {
  const { selection } = state
  if (!(selection instanceof CellSelection)) return null

  const rect = selectedRect(state)
  const options = readRowSwapOptions(rect)
  if (!options[direction].includes(distance)) return null

  const { firstRow, endRow } = options
  const up = direction === 'up'
  const length = endRow - firstRow
  const start = up ? firstRow - distance : firstRow
  const target = start + distance
  const { content } = rect.table
  const offsets: number[] = []
  content.forEach((_, offset) => offsets.push(offset))
  offsets.push(content.size)

  const first = content.cut(offsets[start]!, offsets[start + length]!)
  const between = content.cut(offsets[start + length]!, offsets[target]!)
  const second = content.cut(offsets[target]!, offsets[target + length]!)
  const position = rect.tableStart + offsets[start]!
  const tr = state.tr.replaceWith(position, position + first.size + between.size + second.size, second.append(between).append(first))

  const shift = up ? -(first.size + between.size) : between.size + second.size
  return tr.setSelection(CellSelection.create(tr.doc, selection.$anchorCell.pos + shift, selection.$headCell.pos + shift))
}
