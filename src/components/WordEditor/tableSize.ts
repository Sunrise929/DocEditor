export type TableSize = {
  rows: number
  cols: number
}

export const MAX_TABLE_CELLS = 5000

type TableSizeDraft = {
  rows: number | null | undefined
  cols: number | null | undefined
}

export const isValidTableSize = (size: TableSizeDraft): size is TableSize => {
  const { rows, cols } = size
  return typeof rows === 'number' && typeof cols === 'number'
    && Number.isSafeInteger(rows) && Number.isSafeInteger(cols)
    && rows > 0 && cols > 0 && rows * cols <= MAX_TABLE_CELLS
}
