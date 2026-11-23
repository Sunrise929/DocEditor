export const inlineFormatCommands = {
  bold: 'toggleBold',
  italic: 'toggleItalic',
  underline: 'toggleUnderline',
} as const

export type InlineFormat = keyof typeof inlineFormatCommands
export type InlineFormatState = Record<InlineFormat, boolean>
