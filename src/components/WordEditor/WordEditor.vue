<script setup lang="ts">
import { Extension, findParentNodeClosestToPos, mergeAttributes, Node as TiptapNode, type Attributes, type Editor } from '@tiptap/core'
import { CodeBlock } from '@tiptap/extension-code-block'
import { TableKit } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'
import { closeHistory } from '@tiptap/pm/history'
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { canJoin } from '@tiptap/pm/transform'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import WordRulers from '../WordRulers/WordRulers.vue'
import WordTableInsertControls from './WordTableInsertControls.vue'
import WordTableResizeControls from './WordTableResizeControls.vue'
import TableColumnSettingsDialog from './TableColumnSettingsDialog.vue'
import {
  BlockFontSize, InlineTextStyle, parseFontSize, readSelectionFontSize, setFontSizeAtCursor, setFontSizeInCells,
} from './blockFontSize'
import { blockStyleOptions, DocumentHeading, isHeadingLevel, type DocumentBlockStyle } from './documentHeading'
import {
  DocumentTable, DocumentTableCell, DocumentTableHeader, hasHeaderRow, PreventNestedTables,
  readTableIndent, tableAtSelection, tableCellCommands, tableColumnFractions, toggleFirstRowHeader,
  type TableCellAction, type TableCellAlignment, type TableCellAlignmentState,
} from './documentTable'
import { inlineFormatCommands, type InlineFormat, type InlineFormatState } from './inlineFormatting'
import {
  cellAtPosition, cellTextBox, readTableRuler, resizeTableColumns, type ColumnResizeTarget, type TableRulerContext,
} from './tableRuler'
import { changeTableBorders, readTableBorders, type TableBorderChange, type TableBorders } from './tableBorders'
import {
  toCentimeters, toColumnPixels, toColumnUnits, widthUnitsFromFractions,
  type TableColumnLayout, type TableColumnSettings,
} from './tableColumnLayout'
import { isValidTableSize, type TableSize } from './tableSize'
import {
  DEFAULT_PAGE_MARGINS, fitPageMargins, pageDimensions, readPageOrientation,
  samePageMargins, validPageMargins, type PageMargins, type PageOrientation,
} from './pageGeometry'
import { adjustCellIndent, adjustIndent, indentDefaults, type IndentHandle, type ParagraphIndent } from '../WordRulers/paragraphIndent'

defineOptions({ name: 'WordEditor' })

const emit = defineEmits<{
  blockStyleChange: [style: DocumentBlockStyle | null]
  blockFontSizeChange: [size: number | null, available: boolean]
  inlineFormatsChange: [formats: InlineFormatState]
  pageOrientationChange: [orientation: PageOrientation]
  pageMarginsChange: [margins: PageMargins]
  tableInsertionAvailabilityChange: [available: boolean]
  tableHeaderChange: [header: boolean | null]
  tableNumberedChange: [numbered: boolean | null]
  tableBordersChange: [borders: TableBorders | null]
  tableCellActionChange: [action: TableCellAction | null]
  tableCellAlignmentChange: [state: TableCellAlignmentState]
}>()

const props = withDefaults(defineProps<{
  showRulers?: boolean
  showTableGridlines?: boolean
  ribbonPanelPinned?: boolean
}>(), {
  showRulers: true,
  showTableGridlines: true,
  ribbonPanelPinned: true,
})

type PageEntry = {
  node: ProseMirrorNode
  pos: number
}

type MarginKey = keyof PageMargins

const currentPageNumber = ref(1)
const currentPageMargins = ref<PageMargins>({ ...DEFAULT_PAGE_MARGINS })
const currentPageDimensions = ref(pageDimensions('portrait'))
const currentPageOffset = ref(0)
const documentWidth = ref(currentPageDimensions.value.width)
let layoutDoc: ProseMirrorNode | undefined
let pageOrientations: PageOrientation[] = []
const paragraphIndent = ref<ParagraphIndent | null>(null)
const tableColumnDialog = ref<InstanceType<typeof TableColumnSettingsDialog> | null>(null)
let tableColumnTarget: { position: number; node: ProseMirrorNode; settings: TableColumnSettings } | null = null
const tableRuler = shallowRef<TableRulerContext | null>(null)
type RulerPage = {
  number: number
  dimensions: ReturnType<typeof pageDimensions>
  margins: PageMargins
  offset: number
}
const columnResizeRuler = shallowRef<{ page: RulerPage; context: TableRulerContext; index: number } | null>(null)
const columnResizeOffset = ref(0)
const rulerPage = computed<RulerPage>(() => columnResizeRuler.value?.page ?? {
  number: currentPageNumber.value,
  dimensions: currentPageDimensions.value,
  margins: currentPageMargins.value,
  offset: currentPageOffset.value,
})
const rulerColumnPreview = computed(() => columnResizeRuler.value
  ? { index: columnResizeRuler.value.index, offset: columnResizeOffset.value }
  : null)
let tableRulerFrame = 0
let tableRulerObserver: ResizeObserver | undefined
let observedTable: HTMLTableElement | undefined
let tableScroller: HTMLElement | null | undefined
const indentKeys = Object.keys(indentDefaults) as (keyof ParagraphIndent)[]
const indentableBlockTypes = ['paragraph', 'heading']
const isIndentableBlock = (node: ProseMirrorNode) =>
  indentableBlockTypes.includes(node.type.name)

const BlockIndentation = Extension.create({
  name: 'blockIndentation',
  addGlobalAttributes() {
    const properties = {
      indentLeft: ['data-indent-left', 'margin-left'],
      indentRight: ['data-indent-right', 'margin-right'],
      firstLineOffset: ['data-first-line-offset', 'text-indent'],
    } as const
    return [{
      types: indentableBlockTypes,
      attributes: Object.fromEntries(indentKeys.map(key => {
        const [attribute, property] = properties[key]
        return [key, {
          default: 0,
          parseHTML: (element: HTMLElement) => marginValue(element.getAttribute(attribute), 0),
          renderHTML: (attrs: Record<string, unknown>) => {
            const value = marginValue(attrs[key], 0)
            return value ? { [attribute]: value, style: `${property}: ${value}cm` } : {}
          },
        }]
      })),
    }]
  },
})

const readIndent = (node: ProseMirrorNode): ParagraphIndent => ({
  indentLeft: marginValue(node.attrs.indentLeft, 0),
  indentRight: marginValue(node.attrs.indentRight, 0),
  firstLineOffset: marginValue(node.attrs.firstLineOffset, 0),
})

const syncBlockIndent = (instance: Editor) => {
  const { $head } = instance.state.selection
  const next = isIndentableBlock($head.parent) ? readIndent($head.parent) : null
  const previous = paragraphIndent.value
  if (next ? !previous || indentKeys.some(key => next[key] !== previous[key]) : previous) {
    paragraphIndent.value = next
  }
}

const syncBlockStyle = ({ state }: Editor) => {
  const { $head } = state.selection
  const { type, attrs } = $head.parent
  const { size, available } = readSelectionFontSize(state)
  emit('blockFontSizeChange', size, available)
  const style = type.name === 'heading' && isHeadingLevel(attrs.level)
    ? attrs.level
    : type.name === 'paragraph' ? 'paragraph' : null
  const alternate = style === 'paragraph' ? state.schema.nodes.heading : state.schema.nodes.paragraph

  if (style === null || !alternate || $head.depth === 0) {
    emit('blockStyleChange', null)
    return
  }

  const parent = $head.node($head.depth - 1)
  const index = $head.index($head.depth - 1)
  emit('blockStyleChange', parent.canReplaceWith(index, index + 1, alternate) ? style : null)
}

const syncInlineFormats = (instance: Editor) => {
  emit('inlineFormatsChange', {
    bold: instance.isActive('bold'),
    italic: instance.isActive('italic'),
    underline: instance.isActive('underline'),
  })
}

const observeRulerTable = (element?: HTMLTableElement) => {
  if (element === observedTable) return
  tableRulerObserver?.disconnect()
  tableScroller?.removeEventListener('scroll', refreshTableRuler)
  observedTable = element
  tableScroller = element?.parentElement
  tableScroller?.addEventListener('scroll', refreshTableRuler, { passive: true })
  if (element) {
    tableRulerObserver ??= new ResizeObserver(refreshTableRuler)
    tableRulerObserver.observe(element)
  }
}

const refreshTableRuler = () => {
  const instance = editor.value
  if (!props.showRulers || !instance || instance.isDestroyed || !tableAtSelection(instance.state.selection)) {
    cancelAnimationFrame(tableRulerFrame)
    tableRulerFrame = 0
    tableRuler.value = null
    observeRulerTable()
    return
  }
  if (tableRulerFrame) return
  tableRulerFrame = requestAnimationFrame(() => {
    tableRulerFrame = 0
    if (instance.isDestroyed) return
    const next = readTableRuler(instance.view, currentPageDimensions.value.width)
    observeRulerTable(next?.element)
    tableRuler.value = next?.context ?? null
  })
}

const forEachCellAtSelection = (selection: Selection, visit: (cell: ProseMirrorNode, position: number) => void) => {
  if (selection instanceof CellSelection) {
    selection.forEachCell(visit)
    return
  }

  const cell = cellAtPosition(selection.$head)
  if (cell) visit(cell.node, cell.pos)
}

const readTableCellAlignment = (selection: Selection): TableCellAlignmentState => {
  const result: TableCellAlignmentState = { available: false, alignment: null }
  forEachCellAtSelection(selection, cell => {
    const { textAlign, verticalAlign } = cell.attrs
    if (!result.available && textAlign && verticalAlign) {
      result.alignment = { textAlign, verticalAlign }
    }
    if (result.alignment?.textAlign !== textAlign || result.alignment?.verticalAlign !== verticalAlign) {
      result.alignment = null
    }
    result.available = true
  })
  return result
}

const syncTableTools = (instance: Editor) => {
  const { state } = instance
  const table = tableAtSelection(state.selection)
  const mergeAvailable = table && tableCellCommands.merge(state)
  const splitAvailable = table && !mergeAvailable && tableCellCommands.split(state)
  emit('tableCellActionChange', mergeAvailable ? 'merge' : splitAvailable ? 'split' : null)
  emit('tableCellAlignmentChange', readTableCellAlignment(state.selection))
  emit('tableInsertionAvailabilityChange', !table)
  emit('tableHeaderChange', table ? hasHeaderRow(table.node) : null)
  emit('tableNumberedChange', table ? table.node.attrs.isNumbered === true : null)
  emit('tableBordersChange', table ? readTableBorders(table.node.attrs.borders) : null)
  refreshTableRuler()
}

const marginValue = (value: unknown, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const pageMarginsFromNode = (node: ProseMirrorNode): PageMargins => ({
  marginTop: marginValue(node.attrs.marginTop, DEFAULT_PAGE_MARGINS.marginTop),
  marginRight: marginValue(node.attrs.marginRight, DEFAULT_PAGE_MARGINS.marginRight),
  marginBottom: marginValue(node.attrs.marginBottom, DEFAULT_PAGE_MARGINS.marginBottom),
  marginLeft: marginValue(node.attrs.marginLeft, DEFAULT_PAGE_MARGINS.marginLeft),
})

const pageAtPosition = (
  doc: ProseMirrorNode,
  position: number,
): (PageEntry & { index: number }) | null => {
  let pos = 0

  for (let index = 0; index < doc.childCount; index += 1) {
    const node = doc.child(index)
    if (
      node.type.name === 'page' &&
      position >= pos &&
      position <= pos + node.nodeSize
    ) {
      return { node, pos, index }
    }

    pos += node.nodeSize
  }

  return null
}

const readPageOffset = (instance: Editor, position: number) => {
  const firstPage = instance.view.nodeDOM(0)
  const page = instance.view.nodeDOM(position)
  return firstPage instanceof HTMLElement && page instanceof HTMLElement
    ? page.getBoundingClientRect().top - firstPage.getBoundingClientRect().top : null
}

const syncCurrentPage = (editorInstance: Editor) => {
  const { doc, selection } = editorInstance.state
  const page = pageAtPosition(doc, selection.head)
  if (!page) return

  let layoutChanged = false
  if (doc !== layoutDoc) {
    layoutDoc = doc
    const nextOrientations: PageOrientation[] = []
    doc.forEach((node) => {
      nextOrientations.push(readPageOrientation(node.attrs.orientation))
    })
    layoutChanged = nextOrientations.length !== pageOrientations.length
      || nextOrientations.some((orientation, index) => pageOrientations[index] !== orientation)
    if (layoutChanged) {
      pageOrientations = nextOrientations
      documentWidth.value = pageDimensions(pageOrientations.includes('landscape') ? 'landscape' : 'portrait').width
    }
  }

  const orientation = readPageOrientation(page.node.attrs.orientation)
  const dimensions = pageDimensions(orientation)
  if (currentPageDimensions.value.width !== dimensions.width) currentPageDimensions.value = dimensions
  if (layoutChanged || currentPageNumber.value !== page.index + 1) {
    currentPageOffset.value = readPageOffset(editorInstance, page.pos) ?? currentPageOffset.value
  }
  currentPageNumber.value = page.index + 1
  const margins = pageMarginsFromNode(page.node)
  if (!samePageMargins(currentPageMargins.value, margins)) {
    currentPageMargins.value = margins
    emit('pageMarginsChange', margins)
  }
  emit('pageOrientationChange', orientation)
}

const removePageWrappersFromClipboard = (slice: Slice) => {
  const copiedNodes: ProseMirrorNode[] = []
  let containsPage = false

  slice.content.forEach((node) => {
    if (node.type.name !== 'page') {
      copiedNodes.push(node)
      return
    }

    containsPage = true
    node.content.forEach((child) => copiedNodes.push(child))
  })

  if (!containsPage) return slice

  const startsWithPage = slice.content.firstChild?.type.name === 'page'
  const endsWithPage = slice.content.lastChild?.type.name === 'page'

  return new Slice(
    Fragment.fromArray(copiedNodes),
    Math.max(0, slice.openStart - (startsWithPage ? 1 : 0)),
    Math.max(0, slice.openEnd - (endsWithPage ? 1 : 0)),
  )
}

const PaginatedDocument = TiptapNode.create({
  name: 'doc',
  topNode: true,
  content: 'page+',
})

const Page = TiptapNode.create({
  name: 'page',
  content: 'block*',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      orientation: {
        default: 'portrait',
        parseHTML: (element) => readPageOrientation(element.getAttribute('data-orientation')),
        renderHTML: (attributes) => ({ 'data-orientation': readPageOrientation(attributes.orientation) }),
      },
      marginTop: {
        default: DEFAULT_PAGE_MARGINS.marginTop,
        parseHTML: (element) =>
          marginValue(
            element.getAttribute('data-margin-top'),
            DEFAULT_PAGE_MARGINS.marginTop,
          ),
        renderHTML: (attributes) => ({
          'data-margin-top': attributes.marginTop,
        }),
      },
      marginRight: {
        default: DEFAULT_PAGE_MARGINS.marginRight,
        parseHTML: (element) =>
          marginValue(
            element.getAttribute('data-margin-right'),
            DEFAULT_PAGE_MARGINS.marginRight,
          ),
        renderHTML: (attributes) => ({
          'data-margin-right': attributes.marginRight,
        }),
      },
      marginBottom: {
        default: DEFAULT_PAGE_MARGINS.marginBottom,
        parseHTML: (element) =>
          marginValue(
            element.getAttribute('data-margin-bottom'),
            DEFAULT_PAGE_MARGINS.marginBottom,
          ),
        renderHTML: (attributes) => ({
          'data-margin-bottom': attributes.marginBottom,
        }),
      },
      marginLeft: {
        default: DEFAULT_PAGE_MARGINS.marginLeft,
        parseHTML: (element) =>
          marginValue(
            element.getAttribute('data-margin-left'),
            DEFAULT_PAGE_MARGINS.marginLeft,
          ),
        renderHTML: (attributes) => ({
          'data-margin-left': attributes.marginLeft,
        }),
      },
    }
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { state, view } = this.editor
        const { $from, empty } = state.selection
        if (!empty || !$from.parent.isTextblock || $from.parentOffset !== 0) return false

        let pageDepth = $from.depth
        while (pageDepth > 0 && $from.node(pageDepth).type.name !== 'page') pageDepth -= 1
        if (pageDepth === 0 || $from.index(pageDepth) !== 0 || $from.depth !== pageDepth + 1) return false

        const pageIndex = $from.index(pageDepth - 1)
        if (pageIndex === 0) return false

        const current = $from.node(pageDepth)
        const previous = state.doc.child(pageIndex - 1)
        const currentPos = $from.before(pageDepth)
        const previousPos = currentPos - previous.nodeSize
        const joinPos = previousPos + 1 + previous.content.size
        const merged = previous.copy(previous.content.append(current.content))
        const transaction = state.tr.replaceWith(
          previousPos,
          currentPos + current.nodeSize,
          merged,
        )

        if (canJoin(transaction.doc, joinPos)) {
          transaction.join(joinPos)
          transaction.setSelection(TextSelection.near(transaction.doc.resolve(joinPos - 1)))
        } else {
          transaction.setSelection(TextSelection.near(transaction.doc.resolve(joinPos), -1))
        }

        view.dispatch(transaction.scrollIntoView())
        return true
      },
    }
  },

  parseHTML() {
    return [{ tag: 'section[data-page]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const margins = pageMarginsFromNode(node)
    const { width, height } = pageDimensions(readPageOrientation(node.attrs.orientation))

    return [
      'section',
      mergeAttributes(HTMLAttributes, {
        'data-page': '',
        style: [
          `--page-width: ${width}mm`,
          `--page-height: ${height}mm`,
          `--page-margin-top: ${margins.marginTop}mm`,
          `--page-margin-right: ${margins.marginRight}mm`,
          `--page-margin-bottom: ${margins.marginBottom}mm`,
          `--page-margin-left: ${margins.marginLeft}mm`,
        ].join('; '),
      }),
      ['div', { 'data-page-content': '' }, 0],
    ]
  },
})

const Pagination = Extension.create({
  name: 'pagination',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        view(editorView) {
          const dirtyPages = new Set<number>()
          const backwardFlowPages = new Set<number>()
          let animationFrame: number | null = null
          let destroyed = false
          let internalDispatch = false

          const dispatchPagination = (
            transaction: Parameters<typeof editorView.dispatch>[0],
          ) => {
            internalDispatch = true
            try {
              editorView.dispatch(transaction)
            } finally {
              internalDispatch = false
            }
          }

          const pageEntries = (): PageEntry[] => {
            const entries: PageEntry[] = []

            editorView.state.doc.forEach((node, pos) => {
              if (node.type.name === 'page') {
                entries.push({ node, pos })
              }
            })

            return entries
          }

          const pageIndexAt = (position: number) => {
            let result = 0

            editorView.state.doc.forEach((node, pos, index) => {
              if (position >= pos && position <= pos + node.nodeSize) {
                result = index
              }
            })

            return result
          }

          const requestRun = (...indexes: number[]) => {
            indexes.forEach((index) => {
              if (index >= 0) dirtyPages.add(index)
            })

            if (animationFrame === null && !destroyed) {
              animationFrame = window.requestAnimationFrame(run)
            }
          }

          const pageElements = () =>
            Array.from(editorView.dom.querySelectorAll<HTMLElement>(':scope > [data-page]'))

          const isEmptyPage = (page: ProseMirrorNode) => {
            if (page.childCount === 0) return true
            if (page.childCount !== 1) return false

            const child = page.firstChild
            return Boolean(child?.isTextblock && child.content.size === 0)
          }

          const pixels = (value: string) => Number.parseFloat(value) || 0

          const contentBounds = (contentElement: HTMLElement) => {
            const rect = contentElement.getBoundingClientRect()
            const style = window.getComputedStyle(contentElement)

            return {
              rect,
              top: rect.top + pixels(style.paddingTop),
              bottom: rect.bottom - pixels(style.paddingBottom),
            }
          }

          const outerBlockBottom = (element: HTMLElement) => {
            const rect = element.getBoundingClientRect()
            const style = window.getComputedStyle(element)
            return rect.bottom + pixels(style.marginBottom)
          }

          const blockHeight = (element: Element) => {
            const style = window.getComputedStyle(element)
            return element.getBoundingClientRect().height + pixels(style.marginTop) + pixels(style.marginBottom)
          }

          function* candidateHeights(currentContent: HTMLElement, nextContent: HTMLElement) {
            const currentStyle = window.getComputedStyle(currentContent)
            const nextStyle = window.getComputedStyle(nextContent)
            const currentWidth = currentContent.clientWidth - pixels(currentStyle.paddingLeft) - pixels(currentStyle.paddingRight)
            const nextWidth = nextContent.clientWidth - pixels(nextStyle.paddingLeft) - pixels(nextStyle.paddingRight)
            if (Math.abs(currentWidth - nextWidth) < 0.05) {
              for (const element of nextContent.children) yield blockHeight(element)
              return
            }

            // Compare the blocks at the destination width without mutating ProseMirror's DOM.
            const measure = currentContent.cloneNode(false) as HTMLElement
            measure.classList.add('word-pagination-measure')
            measure.setAttribute('aria-hidden', 'true')
            measure.style.width = `${currentContent.getBoundingClientRect().width}px`
            measure.style.padding = `0 ${currentStyle.paddingRight} 0 ${currentStyle.paddingLeft}`
            measure.append(...Array.from(nextContent.children, element => element.cloneNode(true)))
            editorView.dom.after(measure)
            try {
              for (const element of measure.children) yield blockHeight(element)
            } finally {
              measure.remove()
            }
          }

          const preserveMovedSelection = (transaction: Transaction, from: number, to: number, destination: number) => {
            const { selection } = editorView.state
            if (!(selection instanceof TextSelection)) return
            const inside = (position: number) => position >= from && position < to
            if (!inside(selection.anchor) && !inside(selection.head)) return

            const map = (position: number) =>
              inside(position) ? destination + position - from : transaction.mapping.map(position)
            transaction.setSelection(TextSelection.between(
              transaction.doc.resolve(map(selection.anchor)),
              transaction.doc.resolve(map(selection.head)),
            ))
            if (editorView.hasFocus()) transaction.scrollIntoView()
          }

          const removeEmptyNextPage = (
            pageIndex: number,
            entries: PageEntry[],
          ) => {
            const next = entries[pageIndex + 1]
            if (!next || !isEmptyPage(next.node)) return false

            const transaction = editorView.state.tr.delete(
              next.pos,
              next.pos + next.node.nodeSize,
            )
            dispatchPagination(transaction)
            backwardFlowPages.add(pageIndex)
            requestRun(pageIndex)
            return true
          }

          const moveOverflowForward = (
            pageIndex: number,
            entries: PageEntry[],
            contentElement: HTMLElement,
          ) => {
            const current = entries[pageIndex]
            if (!current || current.node.childCount <= 1) return false

            const { bottom: contentBottom } = contentBounds(contentElement)
            const childElements = Array.from(
              contentElement.children,
            ) as HTMLElement[]
            const firstOverflowingIndex = childElements.findIndex(
              (element) => outerBlockBottom(element) > contentBottom + 1,
            )

            if (firstOverflowingIndex < 0) return false

            // Keep an oversized first block on this page to avoid repeat overflow.
            const movingFromIndex = Math.max(1, firstOverflowingIndex)
            let movingOffset = 0

            for (let index = 0; index < movingFromIndex; index += 1) {
              movingOffset += current.node.child(index).nodeSize
            }

            const movingContent = current.node.content.cut(movingOffset)
            if (movingContent.size === 0) return false

            const movingFrom = current.pos + 1 + movingOffset
            const movingTo = current.pos + 1 + current.node.content.size
            const next = entries[pageIndex + 1]
            const transaction = editorView.state.tr.delete(movingFrom, movingTo)
            let destination: number

            if (next) {
              destination = transaction.mapping.map(next.pos + 1)
              transaction.insert(destination, movingContent)
            } else {
              const pageType = editorView.state.schema.nodes.page
              if (!pageType) return false

              const newPage = pageType.create(fitPageMargins(pageMarginsFromNode(current.node), 'portrait'), movingContent)
              const pagePosition = transaction.mapping.map(current.pos + current.node.nodeSize)
              transaction.insert(pagePosition, newPage)
              destination = pagePosition + 1
            }

            preserveMovedSelection(transaction, movingFrom, movingTo, destination)
            dispatchPagination(transaction)
            requestRun(pageIndex, pageIndex + 1)
            return true
          }

          const pullFirstBlockBackward = (
            pageIndex: number,
            entries: PageEntry[],
            elements: HTMLElement[],
          ) => {
            const current = entries[pageIndex]
            const next = entries[pageIndex + 1]
            const currentContent = elements[pageIndex]?.querySelector<HTMLElement>(
              '[data-page-content]',
            )
            const nextContent = elements[pageIndex + 1]?.querySelector<HTMLElement>(
              '[data-page-content]',
            )

            if (
              !current ||
              !next ||
              !currentContent ||
              !nextContent ||
              next.node.childCount === 0
            ) {
              return false
            }

            if (currentContent.scrollTop !== 0) currentContent.scrollTop = 0
            if (nextContent.scrollTop !== 0) nextContent.scrollTop = 0

            const { top: contentTop, bottom: contentBottom } =
              contentBounds(currentContent)
            const currentIsEmpty = isEmptyPage(current.node)
            const lastElement = currentContent.lastElementChild as HTMLElement | null
            const occupiedBottom =
              currentIsEmpty || !lastElement
                ? contentTop
                : outerBlockBottom(lastElement)
            const availableHeight = contentBottom - occupiedBottom
            if (availableHeight <= 2) return false
            let index = 0
            let movingSize = 0
            let usedHeight = 0

            for (const height of candidateHeights(currentContent, nextContent)) {
              if (index >= next.node.childCount || usedHeight + height > availableHeight - 2) break

              usedHeight += height
              movingSize += next.node.child(index).nodeSize
              index += 1
            }

            if (movingSize === 0) return false

            const movingFrom = next.pos + 1
            const movingTo = movingFrom + movingSize
            const movingContent = next.node.content.cut(0, movingSize)
            const transaction = editorView.state.tr.delete(movingFrom, movingTo)
            let insertAt = current.pos + 1 + current.node.content.size

            if (currentIsEmpty && current.node.content.size > 0) {
              transaction.delete(
                current.pos + 1,
                current.pos + 1 + current.node.content.size,
              )
              insertAt = current.pos + 1
            }

            transaction.insert(insertAt, movingContent)

            preserveMovedSelection(transaction, movingFrom, movingTo, insertAt)
            dispatchPagination(transaction)
            backwardFlowPages.add(pageIndex)
            backwardFlowPages.add(pageIndex + 1)
            requestRun(pageIndex, pageIndex + 1)
            return true
          }

          const run = () => {
            animationFrame = null
            if (destroyed || dirtyPages.size === 0) return

            const pageIndex = Math.min(...dirtyPages)
            dirtyPages.delete(pageIndex)

            const entries = pageEntries()
            const elements = pageElements()
            const current = entries[pageIndex]
            const contentElement = elements[pageIndex]?.querySelector<HTMLElement>(
              '[data-page-content]',
            )

            editorView.dom.setAttribute(
              'aria-label',
              `文档编辑器，共 ${entries.length} 页`,
            )

            if (!current || !contentElement) {
              if (dirtyPages.size > 0) requestRun()
              return
            }

            // Browsers may scroll an overflow-hidden content box to reveal the
            // caret after a large paste. Pagination must always measure the page
            // from its top; the document workspace owns the visible scrolling.
            if (contentElement.scrollTop !== 0) {
              contentElement.scrollTop = 0
            }

            const lastElement =
              contentElement.lastElementChild as HTMLElement | null
            const isOverflowing = Boolean(
              lastElement &&
                outerBlockBottom(lastElement) >
                  contentBounds(contentElement).bottom + 1,
            )

            if (isOverflowing) {
              if (moveOverflowForward(pageIndex, entries, contentElement)) {
                return
              }
            } else if (backwardFlowPages.has(pageIndex)) {
              if (
                removeEmptyNextPage(pageIndex, entries) ||
                pullFirstBlockBackward(pageIndex, entries, elements)
              ) {
                return
              }

              backwardFlowPages.delete(pageIndex)
            }

            if (dirtyPages.size > 0) requestRun()
          }

          requestRun(0)

          return {
            update(view, previousState) {
              if (internalDispatch || view.state.doc.eq(previousState.doc)) return

              const currentPage = pageIndexAt(view.state.selection.from)
              const contentWasDeleted =
                view.state.doc.content.size < previousState.doc.content.size

              if (contentWasDeleted) {
                backwardFlowPages.add(currentPage - 1)
                backwardFlowPages.add(currentPage)
              } else {
                backwardFlowPages.delete(currentPage - 1)
                backwardFlowPages.delete(currentPage)
              }

              view.state.doc.forEach((page, _pos, index) => {
                const previous = previousState.doc.maybeChild(index)
                if (previous && !page.sameMarkup(previous)) {
                  backwardFlowPages.add(index)
                  dirtyPages.add(index)
                }
              })

              requestRun(currentPage - 1, currentPage)
            },

            destroy() {
              destroyed = true
              if (animationFrame !== null) {
                window.cancelAnimationFrame(animationFrame)
              }
            },
          }
        },
      }),
    ]
  },
})

const DocumentCodeBlock = CodeBlock.extend({
  addAttributes() {
    const inherited: Attributes = this.parent?.() ?? {}
    return {
      language: {
        ...inherited.language,
        parseHTML: (element: HTMLElement) =>
          element.firstElementChild?.getAttribute('data-language')
          ?? inherited.language?.parseHTML?.(element)
          ?? null,
      },
    }
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'pre',
      HTMLAttributes,
      ['code', { 'data-language': node.attrs.language }, 0],
    ]
  },
})

// Keep one ProseMirror instance for the whole document so 100+ pages do not
// create 100+ independent editors, histories, and event systems.
const editor = useEditor({
  extensions: [
    StarterKit.configure({ document: false, heading: false, codeBlock: false }),
    TableKit.configure({
      table: false,
      tableCell: false,
      tableHeader: false,
    }),
    DocumentTable,
    DocumentTableCell,
    DocumentTableHeader,
    PreventNestedTables,
    DocumentCodeBlock,
    DocumentHeading,
    BlockIndentation,
    BlockFontSize,
    InlineTextStyle,
    PaginatedDocument,
    Page,
    Pagination,
  ],
  content: {
    type: 'doc',
    content: [
      {
        type: 'page',
        content: [
          ...blockStyleOptions.map(({ value, label }) => ({
            type: value === 'paragraph' ? 'paragraph' : 'heading',
            ...(value === 'paragraph' ? {} : { attrs: { level: value } }),
            content: [{ type: 'text', text: label }],
          })),
          {
            type: 'table',
            content: Array.from({ length: 10 }, () => ({
              type: 'tableRow',
              content: Array.from({ length: 10 }, () => ({
                type: 'tableCell',
                content: [{ type: 'paragraph' }],
              })),
            })),
          },
          { type: 'paragraph' },
        ],
      },
    ],
  },
  editorProps: {
    transformCopied: removePageWrappersFromClipboard,
    attributes: {
      'data-document-root': '',
      spellcheck: 'true',
    },
  },
  onCreate: ({ editor: editorInstance }) => {
    syncCurrentPage(editorInstance)
    syncBlockIndent(editorInstance)
    syncBlockStyle(editorInstance)
    syncInlineFormats(editorInstance)
    syncTableTools(editorInstance)
  },
  onTransaction: ({ editor: editorInstance }) => {
    syncCurrentPage(editorInstance)
    syncBlockIndent(editorInstance)
    syncBlockStyle(editorInstance)
    syncInlineFormats(editorInstance)
    syncTableTools(editorInstance)
  },
})

watch(() => props.showRulers, refreshTableRuler)
onBeforeUnmount(() => {
  cancelAnimationFrame(tableRulerFrame)
  observeRulerTable()
})

const startColumnResizeRuler = (target: ColumnResizeTarget) => {
  const instance = editor.value
  if (!instance) return
  const page = pageAtPosition(instance.state.doc, target.tablePos + 1)
  if (!page) return

  const dimensions = pageDimensions(readPageOrientation(page.node.attrs.orientation))
  const preview = readTableRuler(instance.view, dimensions.width, target)
  if (!preview) return

  columnResizeOffset.value = 0
  columnResizeRuler.value = {
    page: {
      number: page.index + 1,
      dimensions,
      margins: pageMarginsFromNode(page.node),
      offset: readPageOffset(instance, page.pos) ?? 0,
    },
    context: preview.context,
    index: target.index,
  }
}

const updateColumnResizeRuler = (offset: number) => {
  if (columnResizeRuler.value) columnResizeOffset.value = offset
}

const stopColumnResizeRuler = () => {
  columnResizeRuler.value = null
}

const updateTableColumns = (table: TableRulerContext['table'], widths: number[]) => {
  const instance = editor.value
  if (!instance) return
  const active = tableAtSelection(instance.state.selection)
  if (!active || active.node !== table) return
  const transaction = resizeTableColumns(instance.state, active.start - 1, table, widths)
  if (transaction) instance.view.dispatch(closeHistory(transaction))
}

const updateTableIndent = (originalTable: TableRulerContext['table'], indent: number) => {
  const instance = editor.value
  if (!instance) return
  const { state, view } = instance
  const table = tableAtSelection(state.selection)
  if (!table || table.node !== originalTable || readTableIndent(table.node.attrs.indentLeft) === indent) return
  view.dispatch(closeHistory(state.tr.setNodeAttribute(table.start - 1, 'indentLeft', indent)))
}

const setBlockStyle = (style: DocumentBlockStyle) => {
  const instance = editor.value
  if (!instance || (style !== 'paragraph' && !isHeadingLevel(style))) return
  const { state, view } = instance
  const { $head } = state.selection
  const block = $head.parent
  if (!isIndentableBlock(block)) return

  const target = state.schema.nodes[style === 'paragraph' ? 'paragraph' : 'heading']
  if (!target) return
  const parent = $head.node($head.depth - 1)
  const index = $head.index($head.depth - 1)
  if (!parent.canReplaceWith(index, index + 1, target, block.marks)
      || !target.validContent(block.content)) return

  if (target !== block.type || (style !== 'paragraph' && block.attrs.level !== style)) {
    const formatting = {
      ...readIndent(block),
      fontSize: parseFontSize(block.attrs.fontSize),
    }
    const attrs = style === 'paragraph' ? formatting : { ...formatting, level: style }
    view.dispatch(state.tr.setNodeMarkup($head.before(), target, attrs).scrollIntoView())
  }
  view.focus()
}

const setBlockFontSize = (size: number, focusEditor: boolean) => {
  const instance = editor.value
  if (!instance || parseFontSize(size) === null) return
  const { state, view } = instance
  const { selection } = state
  if (selection instanceof CellSelection) {
    const transaction = setFontSizeInCells(state, selection, size)
    if (transaction.docChanged) view.dispatch(closeHistory(transaction))
  } else if (!selection.empty) {
    instance.commands.setMark('textStyle', { fontSize: size })
  } else if (isIndentableBlock(selection.$head.parent)) {
    const transaction = setFontSizeAtCursor(state, size)
    if (transaction.docChanged || transaction.storedMarksSet) view.dispatch(transaction)
  } else {
    return
  }
  if (focusEditor) view.focus()
}

const updateBlockIndent = (handle: IndentHandle, delta: number) => {
  const instance = editor.value
  if (!instance || !delta) return
  const { doc, selection, tr } = instance.state
  const { view } = instance
  const cellWidths = new Map<number, number>()
  const update = (node: ProseMirrorNode, pos: number) => {
    if (!isIndentableBlock(node)) return
    const page = pageAtPosition(doc, pos + 1)
    if (!page) return false
    const { marginLeft, marginRight } = pageMarginsFromNode(page.node)
    const { width } = pageDimensions(readPageOrientation(page.node.attrs.orientation))
    const before = readIndent(node)
    const cell = cellAtPosition(doc.resolve(pos + 1))
    let after: ParagraphIndent
    if (cell) {
      let cellWidth = cellWidths.get(cell.pos)
      if (cellWidth === undefined) {
        const box = cellTextBox(view, cell.pos)
        const pageElement = view.nodeDOM(page.pos)
        if (!box || !(pageElement instanceof HTMLElement)) return false
        const pagePixels = pageElement.getBoundingClientRect().width
        if (!pagePixels) return false
        cellWidth = (box.end - box.start) / pagePixels * width / 10
        if (!cellWidth) return false
        cellWidths.set(cell.pos, cellWidth)
      }
      after = adjustCellIndent(before, handle, delta, cellWidth)
    } else {
      after = adjustIndent(before, handle, delta, (width - marginLeft - marginRight) / 10, marginLeft / 10, marginRight / 10)
    }
    if (indentKeys.some(key => before[key] !== after[key])) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...after })
    }
    return false
  }
  if (selection.empty) {
    const { $from } = selection
    if (isIndentableBlock($from.parent)) update($from.parent, $from.before())
  } else {
    for (const { $from, $to } of selection.ranges) doc.nodesBetween($from.pos, $to.pos, update)
  }
  if (tr.docChanged) view.dispatch(tr)
}

const setCurrentPageMargins = (changes: Partial<PageMargins>, fromRuler = false) => {
  const instance = editor.value
  if (!instance) return
  const { state, view } = instance
  const page = pageAtPosition(state.doc, state.selection.head)
  if (!page) return

  const previous = pageMarginsFromNode(page.node)
  const margins = { ...previous, ...changes }
  if (!samePageMargins(previous, margins) && validPageMargins(margins, readPageOrientation(page.node.attrs.orientation))) {
    const transaction = state.tr.setNodeMarkup(page.pos, undefined, { ...page.node.attrs, ...margins })
    view.dispatch(fromRuler ? transaction.setMeta('addToHistory', false) : closeHistory(transaction).scrollIntoView())
  }
  if (!fromRuler) view.focus()
}

const updateCurrentPageMargin = (key: MarginKey, value: number) =>
  setCurrentPageMargins({ [key]: value }, true)

const setCurrentPageOrientation = (orientation: PageOrientation) => {
  const instance = editor.value
  if (!instance) return
  const { state, view } = instance
  const page = pageAtPosition(state.doc, state.selection.head)
  if (!page) return

  if (orientation !== readPageOrientation(page.node.attrs.orientation)) {
    const margins = fitPageMargins(pageMarginsFromNode(page.node), orientation)
    view.dispatch(closeHistory(state.tr.setNodeMarkup(page.pos, undefined, {
      ...page.node.attrs,
      ...margins,
      orientation,
    })).scrollIntoView())
  }
  view.focus()
}

const insertTable = (size: TableSize) => {
  const instance = editor.value
  if (!instance || !isValidTableSize(size) || tableAtSelection(instance.state.selection)) return

  const inserted = instance.chain()
    .command(({ tr }) => {
      closeHistory(tr)
      if (!tr.selection.empty) tr.setSelection(Selection.near(tr.selection.$head))
      return true
    })
    .insertTable({ ...size, withHeaderRow: false })
    .command(({ tr, state }) => {
      const table = findParentNodeClosestToPos(tr.selection.$head, node => node.type === state.schema.nodes.table)
      const paragraph = state.schema.nodes.paragraph
      if (!table || !paragraph) return true

      const afterTable = tr.doc.resolve(table.pos + table.node.nodeSize)
      const index = afterTable.index()
      if (index === afterTable.parent.childCount && afterTable.parent.canReplaceWith(index, index, paragraph)) {
        tr.insert(afterTable.pos, paragraph.create())
      }
      return true
    })
    .run()

  if (inserted) instance.view.focus()
}

const setTableBorders = (change: TableBorderChange) => {
  const instance = editor.value
  if (!instance) return
  const { state, view } = instance
  const table = tableAtSelection(state.selection)
  if (!table) return

  const borders = changeTableBorders(readTableBorders(table.node.attrs.borders), change)
  const transaction = state.tr.setNodeAttribute(table.start - 1, 'borders', borders)
  if (!transaction.doc.eq(state.doc)) view.dispatch(closeHistory(transaction))
  view.focus()
}

const alignTableCells = (requested: TableCellAlignment) => {
  const instance = editor.value
  if (!instance) return

  const { state, view } = instance
  const { available, alignment } = readTableCellAlignment(state.selection)
  if (!available) return

  const reset = alignment?.textAlign === requested.textAlign
    && alignment?.verticalAlign === requested.verticalAlign
  const textAlign = reset ? null : requested.textAlign
  const verticalAlign = reset ? null : requested.verticalAlign
  const transaction = state.tr
  forEachCellAtSelection(state.selection, (cell, position) => {
    if (cell.attrs.textAlign !== textAlign) transaction.setNodeAttribute(position, 'textAlign', textAlign)
    if (cell.attrs.verticalAlign !== verticalAlign) transaction.setNodeAttribute(position, 'verticalAlign', verticalAlign)
  })
  if (transaction.docChanged) view.dispatch(closeHistory(transaction))
  view.focus()
}

const editTableCells = (action: TableCellAction) => {
  const instance = editor.value
  if (!instance) return
  const { state, view } = instance
  const changed = tableCellCommands[action](state, transaction => view.dispatch(closeHistory(transaction)))
  if (changed) view.focus()
}

const toggleTableHeader = () => {
  const instance = editor.value
  if (!instance) return
  const transaction = toggleFirstRowHeader(instance.state)
  if (!transaction?.docChanged) return

  instance.view.dispatch(closeHistory(transaction))
  instance.view.focus()
}

const toggleTableNumbered = () => {
  const instance = editor.value
  if (!instance) return
  const { state, view } = instance
  const table = tableAtSelection(state.selection)
  if (!table) return

  const numbered = table.node.attrs.isNumbered !== true
  view.dispatch(closeHistory(state.tr.setNodeAttribute(table.start - 1, 'isNumbered', numbered)))
  view.focus()
}

const columnSettingsPageWidth = (doc: ProseMirrorNode, position: number) => {
  const page = pageAtPosition(doc, position)
  if (!page) return null
  const { width } = pageDimensions(readPageOrientation(page.node.attrs.orientation))
  const { marginLeft, marginRight } = pageMarginsFromNode(page.node)
  return toColumnUnits((width - marginLeft - marginRight) / 10)
}

const showTableColumnSettings = () => {
  const instance = editor.value
  const dialog = tableColumnDialog.value
  if (!instance || !dialog) return
  const { state } = instance
  const table = tableAtSelection(state.selection)
  if (!table) return
  const availableWidth = columnSettingsPageWidth(state.doc, table.start)
  if (availableWidth === null) return

  const indentLeft = toColumnUnits(readTableIndent(table.node.attrs.indentLeft))
  const widths = widthUnitsFromFractions(tableColumnFractions(table.node), Math.max(0, availableWidth - indentLeft))
  if (!widths.length) return

  const settings: TableColumnSettings = {
    availableWidth,
    layout: { widths, indentLeft },
    subjectIndex: table.node.attrs.isNumbered === true ? (widths.length > 1 ? 1 : null) : 0,
  }
  tableColumnTarget = { position: table.start - 1, node: table.node, settings }
  dialog.show(settings)
}

const applyTableColumnSettings = (layout: TableColumnLayout) => {
  const instance = editor.value
  const target = tableColumnTarget
  if (!instance || !target) return false
  const { state, view } = instance
  const { position, node, settings } = target
  if (state.doc.nodeAt(position) !== node || columnSettingsPageWidth(state.doc, position + 1) !== settings.availableWidth) {
    return false
  }
  if (layout.indentLeft === settings.layout.indentLeft
    && layout.widths.every((width, index) => width === settings.layout.widths[index])) return true

  const widths = layout.widths.map(toColumnPixels)
  const transaction = resizeTableColumns(state, position, node, widths) ?? state.tr
  if (layout.indentLeft !== settings.layout.indentLeft) {
    transaction.setNodeAttribute(position, 'indentLeft', toCentimeters(layout.indentLeft))
  }
  if (transaction.docChanged) view.dispatch(closeHistory(transaction))
  return true
}

const closeTableColumnSettings = () => {
  tableColumnTarget = null
  const instance = editor.value
  if (instance && !instance.isDestroyed) instance.view.focus()
}

const undo = () => {
  return editor.value?.chain().focus().undo().run() ?? false
}

const redo = () => {
  return editor.value?.chain().focus().redo().run() ?? false
}

const getJSON = () => editor.value?.getJSON()

const toggleInlineFormat = (format: InlineFormat) => {
  const instance = editor.value
  if (!instance) return
  instance.chain().focus()[inlineFormatCommands[format]]().run()
}

defineExpose({
  getJSON, undo, redo, setBlockStyle, setBlockFontSize, toggleInlineFormat,
  setCurrentPageOrientation, setCurrentPageMargins, insertTable,
  toggleTableHeader, toggleTableNumbered, setTableBorders, showTableColumnSettings, editTableCells, alignTableCells,
})
</script>

<template>
  <div
    class="word-editor-canvas"
    :class="{
      'is-ribbon-panel-pinned': ribbonPanelPinned,
      'is-table-gridlines-hidden': !showTableGridlines,
    }"
    :style="{
      '--document-width': `${documentWidth}mm`,
      '--current-page-width': `${rulerPage.dimensions.width}mm`,
      '--current-page-height': `${rulerPage.dimensions.height}mm`,
    }"
  >
    <WordRulers
      v-if="showRulers"
      :current-page-number="rulerPage.number"
      :page-width="rulerPage.dimensions.width"
      :page-height="rulerPage.dimensions.height"
      :page-offset="rulerPage.offset"
      :margins="rulerPage.margins"
      :paragraph-indent="columnResizeRuler && !columnResizeRuler.context.cell ? null : paragraphIndent"
      :table-ruler="columnResizeRuler?.context ?? tableRuler"
      :column-resize-preview="rulerColumnPreview"
      @column-resize="updateTableColumns"
      @table-indent-change="updateTableIndent"
      @margin-change="updateCurrentPageMargin"
      @indent-change="updateBlockIndent"
    />

    <main class="document-workspace">
      <EditorContent v-if="editor" :editor="editor" class="paginated-editor" />
    </main>
    <TableColumnSettingsDialog
      ref="tableColumnDialog"
      :apply="applyTableColumnSettings"
      @closed="closeTableColumnSettings"
    />
    <WordTableInsertControls v-if="editor" :editor="editor" />
    <WordTableResizeControls
      v-if="editor"
      :editor="editor"
      @column-resize-start="startColumnResizeRuler"
      @column-resize-preview="updateColumnResizeRuler"
      @column-resize-end="stopColumnResizeRuler"
    />
  </div>
</template>

<style src="./WordEditor.css"></style>
