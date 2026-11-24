export const indentDefaults = {
  indentLeft: 0,
  indentRight: 0,
  firstLineOffset: 0,
}

export type ParagraphIndent = typeof indentDefaults
export type IndentHandle = 'first' | 'hanging' | 'left' | 'right'

const MIN_TEXT_WIDTH_CM = 1.5

export function adjustIndent(
  indent: ParagraphIndent,
  handle: IndentHandle,
  delta: number,
  width: number,
  leftPageMargin: number,
  rightPageMargin: number,
  minTextWidth = MIN_TEXT_WIDTH_CM,
): ParagraphIndent {
  const { indentLeft: left, indentRight: right, firstLineOffset: offset } = indent
  const first = left + offset
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value))
  const end = width - right - minTextWidth

  switch (handle) {
    case 'first':
      return { ...indent, firstLineOffset: clamp(first + delta, -leftPageMargin, end) - left }
    case 'hanging': {
      const indentLeft = clamp(left + delta, -leftPageMargin, end)
      return { ...indent, indentLeft, firstLineOffset: first - indentLeft }
    }
    case 'left':
      return { ...indent, indentLeft: clamp(left + delta, -leftPageMargin + Math.max(0, -offset), end - Math.max(0, offset)) }
    case 'right':
      return { ...indent, indentRight: clamp(right + delta, -rightPageMargin, width - Math.max(left, first) - minTextWidth) }
  }
}

export function adjustCellIndent(indent: ParagraphIndent, handle: IndentHandle, delta: number, width: number) {
  return adjustIndent(indent, handle, delta, width, 0, 0, Math.min(MIN_TEXT_WIDTH_CM, width / 2))
}
