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
  numberGap?: number,
  minTextWidth = MIN_TEXT_WIDTH_CM,
): ParagraphIndent {
  const { indentLeft: left, indentRight: right } = indent
  const offset = numberGap === undefined ? indent.firstLineOffset : Math.min(indent.firstLineOffset, -numberGap)
  const first = left + offset
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value))
  const end = width - right - minTextWidth

  switch (handle) {
    case 'first': {
      const limit = numberGap === undefined ? end : Math.min(end, left - numberGap)
      return { ...indent, firstLineOffset: Math.min(limit, clamp(first + delta, -leftPageMargin, limit)) - left }
    }
    case 'hanging': {
      const start = numberGap === undefined ? -leftPageMargin : Math.max(-leftPageMargin, first + numberGap)
      const indentLeft = clamp(left + delta, start, end)
      return { ...indent, indentLeft, firstLineOffset: first - indentLeft }
    }
    case 'left':
      return {
        ...indent,
        indentLeft: clamp(left + delta, -leftPageMargin + Math.max(0, -offset), end - Math.max(0, offset)),
        firstLineOffset: offset,
      }
    case 'right':
      return { ...indent, indentRight: clamp(right + delta, -rightPageMargin, width - Math.max(left, first) - minTextWidth) }
  }
}

export function adjustCellIndent(
  indent: ParagraphIndent, handle: IndentHandle, delta: number, width: number, numberGap?: number,
) {
  return adjustIndent(indent, handle, delta, width, 0, 0, numberGap, Math.min(MIN_TEXT_WIDTH_CM, width / 2))
}
