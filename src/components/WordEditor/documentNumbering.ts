import { Extension, InputRule, mergeAttributes, Node } from '@tiptap/core'
import Paragraph from '@tiptap/extension-paragraph'
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model'
import { Plugin, TextSelection, type Transaction } from '@tiptap/pm/state'
import { canSplit } from '@tiptap/pm/transform'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { headingNumberType, isHeadingLevel } from './documentHeading'
import { documentLayout, forEachDocumentPage, newSectionId, pageAtPosition } from './documentSections'
import {
  formatNumberLabel, isNumberFormat, isNumberSuffix, isNumberWrapper, isPositiveInteger,
  numberPrefixPattern, parseNumberPrefix, type NumberStyle,
} from './numberFormats'

type Numbering = NumberStyle & {
  listId: string
  level: number
  label: string
  startAt?: number
  restartAt?: number
  continueAfter?: true
}

const numberedBlockTypes = ['paragraph', 'heading']
const markerGapCm = 0.15
const defaultIndentCm = 0.75
const cmPerPixel = 2.54 / 96

const readNumbering = (value: unknown): Numbering | null => {
  if (!value || typeof value !== 'object' || !('listId' in value) || !('level' in value) ||
      typeof value.listId !== 'string' || !value.listId || !isPositiveInteger(value.level) ||
      !('format' in value) || !isNumberFormat(value.format) || !('suffix' in value) || !isNumberSuffix(value.suffix) ||
      !('wrapper' in value) || !isNumberWrapper(value.wrapper) ||
      !('uppercase' in value) || typeof value.uppercase !== 'boolean' ||
      !('label' in value) || typeof value.label !== 'string') return null
  const { listId, level, format, suffix, wrapper, uppercase, label } = value
  const numbering: Numbering = { listId, level, format, suffix, wrapper, uppercase, label }
  if ('startAt' in value && isPositiveInteger(value.startAt)) numbering.startAt = value.startAt
  if ('restartAt' in value && isPositiveInteger(value.restartAt)) numbering.restartAt = value.restartAt
  if ('continueAfter' in value && value.continueAfter === true) numbering.continueAfter = true
  return numbering
}

const parseNumbering = (attribute: string | null): Numbering | null => {
  if (!attribute) return null
  try {
    return readNumbering(JSON.parse(attribute))
  } catch {
    return null
  }
}

const blockNumber = (block: ProseMirrorNode) =>
  block.firstChild?.type.name === headingNumberType ? block.firstChild : null

const afterNumber = ($pos: ResolvedPos) => {
  const marker = $pos.parentOffset === 0 ? blockNumber($pos.parent) : null
  return marker ? $pos.pos + marker.nodeSize : null
}

export const readBlockNumbering = (block: ProseMirrorNode) => readNumbering(blockNumber(block)?.attrs)

export const NumberedParagraph = Paragraph.extend({
  content: `${headingNumberType}? inline*`,
  renderHTML({ node, HTMLAttributes }) {
    const markerStyle = blockNumber(node) ? { style: 'text-indent: 0' } : {}
    return ['p', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, markerStyle), 0]
  },
})

export const HeadingNumber = Node.create({
  name: headingNumberType,
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      listId: { default: null, rendered: false },
      level: { default: 1, rendered: false },
      format: { default: 'decimal', rendered: false },
      suffix: { default: '.', rendered: false },
      wrapper: { default: '', rendered: false },
      uppercase: { default: false, rendered: false },
      label: { default: '', rendered: false },
      startAt: { default: null, rendered: false },
      restartAt: { default: null, rendered: false },
      continueAfter: { default: false, rendered: false },
    }
  },

  parseHTML() {
    return [{
      tag: 'span[data-heading-number]',
      getAttrs: element => parseNumbering(element.getAttribute('data-heading-number')) ?? false,
    }]
  },

  renderHTML({ node }) {
    return ['span', {
      'data-heading-number': JSON.stringify(readNumbering(node.attrs)),
      'data-number-marker': '',
      'data-number-label': node.attrs.label,
      'aria-label': node.attrs.label,
      contenteditable: 'false',
    }]
  },
})

const numberingOffset = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

export const readNumberingGap = (view: EditorView, position: number): number | undefined => {
  const block = view.nodeDOM(position)
  if (!(block instanceof HTMLElement)) return undefined
  const marker = block.querySelector<HTMLElement>(':scope > [data-number-marker]')
  const width = marker?.getBoundingClientRect().width
  return width ? width * cmPerPixel + markerGapCm : undefined
}

const readHeadingLevel = (block: ProseMirrorNode) => {
  if (block.type.name !== 'heading') return null
  return isHeadingLevel(block.attrs.level) ? block.attrs.level : 1
}

type NumberingEntry = {
  offset: number
  numbering: Numbering | null
  headingLevel: number | null
  block: ProseMirrorNode
}
const numberingByPage = new WeakMap<ProseMirrorNode, NumberingEntry[]>()

const numberingEntries = (page: ProseMirrorNode): NumberingEntry[] => {
  const cached = numberingByPage.get(page)
  if (cached) return cached
  const entries: NumberingEntry[] = []
  page.descendants((node, offset) => {
    if (!node.isTextblock) return true
    if (numberedBlockTypes.includes(node.type.name)) {
      const numbering = readBlockNumbering(node)
      const headingLevel = readHeadingLevel(node)
      if (numbering || headingLevel !== null) entries.push({ offset, numbering, headingLevel, block: node })
    }
    return false
  })
  numberingByPage.set(page, entries)
  return entries
}

const stopsRestart = (level: number | null, nextHeading: number) =>
  level === null || nextHeading < level

type NumberSequence = { value: number } & NumberStyle

const numberStyle = ({ format, suffix, wrapper, uppercase }: NumberStyle): NumberStyle =>
  ({ format, suffix, wrapper, uppercase })

const updateNumberLabels = (tr: Transaction) => {
  const headingCounters = new Map<number, NumberSequence>()
  const paragraphCounters = new Map<string, number>()
  let paragraphRestart: NumberSequence | undefined

  for (const { node, pos, localIndex } of documentLayout(tr.doc).pages) {
    if (localIndex === 0) headingCounters.clear()
    for (const { offset, numbering, headingLevel, block } of numberingEntries(node)) {
      if (headingLevel !== null) {
        paragraphRestart = undefined
        for (const level of headingCounters.keys()) {
          if (stopsRestart(level, headingLevel)) headingCounters.delete(level)
        }
      }
      const marker = blockNumber(block)
      if (!numbering || !marker) continue

      let sequence: NumberSequence
      if (headingLevel !== null) {
        const previous = headingCounters.get(headingLevel)
        sequence = numbering.restartAt === undefined && previous
          ? { ...previous, value: previous.value + 1 }
          : { ...numberStyle(numbering), value: numbering.restartAt ?? 1 }
        headingCounters.set(headingLevel, sequence)
      } else {
        const key = JSON.stringify([numbering.listId, numbering.level])
        const previous = paragraphCounters.get(key)
        const normalValue = previous === undefined ? numbering.startAt ?? 1 : previous + 1
        paragraphCounters.set(key, normalValue)
        sequence = numbering.restartAt === undefined && paragraphRestart
          ? { ...paragraphRestart, value: paragraphRestart.value + 1 }
          : { ...numberStyle(numbering), value: numbering.restartAt ?? normalValue }
        if (numbering.restartAt !== undefined || paragraphRestart || numbering.continueAfter) {
          paragraphRestart = sequence
        }
      }

      const attrs = { ...numberStyle(sequence), label: formatNumberLabel(sequence.value, sequence) }
      const markerPos = pos + offset + 2
      if (marker.marks.length) {
        tr.setNodeMarkup(markerPos, undefined, { ...marker.attrs, ...attrs }, [])
        continue
      }
      for (const [key, value] of Object.entries(attrs)) {
        if (marker.attrs[key] !== value) tr.setNodeAttribute(markerPos, key, value)
      }
    }
  }
}

const decorateNumbers = (doc: ProseMirrorNode) => {
  const decorations: Decoration[] = []
  forEachDocumentPage(doc, (page, pos) => {
    for (const { offset, block } of numberingEntries(page)) {
      const marker = blockNumber(block)
      if (!marker) continue
      const markerPos = pos + offset + 2
      decorations.push(Decoration.node(markerPos, markerPos + marker.nodeSize, {
        style: numberMarkerStyle(block.attrs.firstLineOffset),
      }))
    }
  })
  return DecorationSet.create(doc, decorations)
}

const numberMarkerStyle = (firstLineOffset: unknown) =>
  `--word-number-offset: ${numberingOffset(firstLineOffset)}cm; --word-number-gap: ${markerGapCm}cm`

const setNumbering = (tr: Transaction, pos: number, block: ProseMirrorNode, numbering: Numbering) => {
  if (blockNumber(block)) return tr.setNodeMarkup(pos + 1, undefined, numbering, [])

  const marker = tr.doc.type.schema.nodes[headingNumberType]!.create(numbering)
  tr.insert(pos + 1, marker)
  return tr.setSelection(TextSelection.create(tr.doc, pos + 1 + marker.nodeSize))
}

const numberingPages = (doc: ProseMirrorNode, position: number, scope: number | null) => {
  const { pages } = documentLayout(doc)
  if (scope === null) return pages

  const section = pageAtPosition(doc, position)?.section
  return section ? pages.slice(section.firstPage, section.firstPage + section.node.childCount) : []
}

const clearFollowingRestarts = (tr: Transaction, position: number, scope: number | null) => {
  // Supersede older manual restarts within the range affected by this edit.
  for (const { node, pos } of numberingPages(tr.doc, position, scope)) {
    if (pos + node.nodeSize <= position) continue
    for (const entry of numberingEntries(node)) {
      const nextPosition = pos + 1 + entry.offset
      if (nextPosition <= position) continue
      if (entry.headingLevel !== null && stopsRestart(scope, entry.headingLevel)) return
      if (entry.headingLevel !== scope || entry.numbering?.restartAt === undefined) continue

      const nextNumbering = { ...entry.numbering }
      delete nextNumbering.restartAt
      setNumbering(tr, nextPosition, entry.block, nextNumbering)
    }
  }
}

const previousNumberFormat = (doc: ProseMirrorNode, position: number, scope: number | null) => {
  const pages = numberingPages(doc, position, scope)
  for (let pageIndex = pages.length - 1; pageIndex >= 0; pageIndex--) {
    const { node, pos } = pages[pageIndex]!
    if (pos >= position) continue
    const entries = numberingEntries(node)
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index]!
      if (pos + 1 + entry.offset >= position) continue
      if (entry.headingLevel !== null && stopsRestart(scope, entry.headingLevel)) return
      if (entry.headingLevel === scope && entry.numbering) return entry.numbering.format
    }
  }
}

export const DocumentNumbering = Extension.create({
  name: 'documentNumbering',
  priority: 150,

  addInputRules() {
    return [new InputRule({
      find: numberPrefixPattern,
      handler: ({ state, range, match }) => {
        const $start = state.doc.resolve(range.from)
        const block = $start.parent
        const prefixSize = blockNumber(block)?.nodeSize ?? 0
        if (!numberedBlockTypes.includes(block.type.name) || $start.parentOffset !== prefixSize) return null

        const pos = $start.before()
        const scope = readHeadingLevel(block)
        const prefix = match[1]!
        const parsed = parseNumberPrefix(prefix, () => previousNumberFormat(state.doc, pos, scope))
        if (!parsed) return null

        const { value: startAt, ...style } = parsed
        const suffix = match[2] ?? ''
        if (!isNumberSuffix(suffix)) return null
        const label = prefix + suffix
        const tr = state.tr.delete(range.from, range.to)
        const current = readBlockNumbering(block)
        if (current) {
          setNumbering(tr, pos, block, { ...current, ...style, suffix, label, restartAt: startAt })
          clearFollowingRestarts(tr, pos, scope)
          return
        }

        const left = numberingOffset(block.attrs.indentLeft)
        const marker = left + numberingOffset(block.attrs.firstLineOffset)
        const body = Math.max(left, marker + defaultIndentCm)
        const numbering: Numbering = { ...style, listId: newSectionId(), level: 1, suffix, label, restartAt: startAt }
        if (startAt !== 1) numbering.startAt = startAt
        tr.setNodeMarkup(pos, undefined, {
          ...block.attrs,
          indentLeft: body,
          firstLineOffset: marker - body,
        })
        setNumbering(tr, pos, block, numbering)
        clearFollowingRestarts(tr, pos, scope)
      },
    })]
  },

  addKeyboardShortcuts() {
    const exitNumbering = (asParagraph: boolean) => {
      const { state, view } = this.editor
      const { selection } = state
      const { $from } = selection
      const block = $from.parent
      const prefixSize = blockNumber(block)?.nodeSize ?? 0
      if (!(selection instanceof TextSelection) || !selection.empty || $from.parentOffset > prefixSize ||
          !readBlockNumbering(block)) return false
      if (!asParagraph && this.editor.commands.undoInputRule()) return true
      const paragraph = state.schema.nodes.paragraph
      const parent = $from.node(-1)
      const index = $from.index(-1)
      const type = asParagraph && paragraph && parent.canReplaceWith(index, index + 1, paragraph)
        ? paragraph : block.type
      const tr = state.tr
      if (prefixSize) tr.delete($from.start(), $from.start() + prefixSize)
      view.dispatch(tr.setNodeMarkup($from.before(), type, {
        ...block.attrs,
        indentLeft: numberingOffset(block.attrs.indentLeft) + numberingOffset(block.attrs.firstLineOffset),
        firstLineOffset: 0,
      }).scrollIntoView())
      return true
    }

    return {
      Enter: () => {
        const { state, view, extensionManager } = this.editor
        const { selection } = state
        if (!(selection instanceof TextSelection) || !selection.$from.sameParent(selection.$to)) return false
        const { $from, $to } = selection
        const block = $from.parent
        const numbering = readBlockNumbering(block)
        if (!numbering) return false
        const atom = blockNumber(block)
        const start = $from.start() + (atom?.nodeSize ?? 0)
        if ($from.end() === start) return exitNumbering(true)

        const tr = state.tr
        const pos = Math.max($from.pos, start)
        if ($to.pos > pos) tr.delete(pos, $to.pos)
        const { listId, level, startAt, label } = numbering
        const nextNumbering: Numbering = { ...numberStyle(numbering), listId, level, label, continueAfter: true }
        if (startAt !== undefined) nextNumbering.startAt = startAt
        if (!canSplit(tr.doc, pos, 1)) return false
        tr.split(pos)
        const nextPosition = pos + 1
        const nextBlock = tr.doc.nodeAt(nextPosition)
        if (!nextBlock) return false
        setNumbering(tr, nextPosition, nextBlock, nextNumbering)
        clearFollowingRestarts(tr, nextPosition, readHeadingLevel(block))

        const marks = state.storedMarks ?? $from.marks()
        tr.ensureMarks(marks.filter(mark => extensionManager.splittableMarks.includes(mark.type.name)))
        view.dispatch(tr.scrollIntoView())
        return true
      },
      Backspace: () => exitNumbering(false),
    }
  },

  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      appendTransaction(transactions, _oldState, { doc, selection, tr }) {
        if (selection instanceof TextSelection && selection.empty &&
            transactions.some(transaction => transaction.getMeta('pointer'))) {
          const position = afterNumber(selection.$head)
          if (position !== null) tr.setSelection(TextSelection.create(doc, position))
        }
        if (transactions.some(transaction => transaction.docChanged)) updateNumberLabels(tr)
        return tr.docChanged || tr.selectionSet ? tr : null
      },
      state: {
        init: (_, { doc }) => decorateNumbers(doc),
        apply: (tr, value) => tr.before.content === tr.doc.content ? value : decorateNumbers(tr.doc),
      },
      props: {
        handleClick(view, pos, event) {
          if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false
          const { doc, tr } = view.state
          const $hit = doc.resolve(pos)
          const marker = blockNumber($hit.parent)
          if (!marker || $hit.parentOffset > marker.nodeSize) return false

          const position = $hit.start() + marker.nodeSize
          view.dispatch(tr.setSelection(TextSelection.create(doc, position)).setMeta('pointer', true))
          view.focus()
          return true
        },
        decorations(state) { return this.getState(state) },
      },
    })]
  },
})
