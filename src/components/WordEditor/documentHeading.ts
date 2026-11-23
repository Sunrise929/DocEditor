import { mergeAttributes, Node, textblockTypeInputRule } from '@tiptap/core'

export type DocumentBlockStyle = 'paragraph' | number

const headingLabels = [
  '大标题', '一级标题', '二级标题', '三级标题', '四级标题',
  '五级标题', '六级标题', '七级标题', '八级标题',
]

export const blockStyleOptions: { value: DocumentBlockStyle; label: string }[] = [
  ...headingLabels.map((label, index) => ({ value: index + 1, label })),
  { value: 'paragraph', label: '正文' },
]

export const isHeadingLevel = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1

const nativeHeadingLevels = [1, 2, 3, 4, 5, 6]

export const DocumentHeading = Node.create({
  name: 'heading',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return { level: { default: 1, rendered: false } }
  },

  parseHTML() {
    return [
      ...nativeHeadingLevels.map(level => ({ tag: `h${level}`, attrs: { level } })),
      {
        tag: 'div[data-heading-level]',
        getAttrs: (element: HTMLElement) => {
          const level = Number(element.getAttribute('data-heading-level'))
          return isHeadingLevel(level) ? { level } : false
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const level = isHeadingLevel(node.attrs.level) ? node.attrs.level : 1
    const attrs = mergeAttributes(HTMLAttributes, {
      'data-heading-level': level,
    })
    if (level <= 6) return [`h${level}`, attrs, 0]
    return ['div', { ...attrs, role: 'heading', 'aria-level': level }, 0]
  },

  addInputRules() {
    return [textblockTypeInputRule({
      find: /^(#{1,6})\s$/,
      type: this.type,
      getAttributes: match => ({ level: match[1]?.length ?? 1 }),
    })]
  },

  addKeyboardShortcuts() {
    return Object.fromEntries(nativeHeadingLevels.map(level => [
      `Mod-Alt-${level}`,
      () => this.editor.commands.toggleNode('heading', 'paragraph', { level }),
    ]))
  },
})
