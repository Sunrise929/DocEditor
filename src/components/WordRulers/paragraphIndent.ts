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
): ParagraphIndent {
  const { indentLeft: left, indentRight: right, firstLineOffset: offset } = indent
  const first = left + offset
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value))
  const end = width - right - MIN_TEXT_WIDTH_CM

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
      return { ...indent, indentRight: clamp(right + delta, -rightPageMargin, width - Math.max(left, first) - MIN_TEXT_WIDTH_CM) }
  }
}
