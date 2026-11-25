<script setup lang="ts">
import { Extension, findParentNodeClosestToPos, mergeAttributes, Node as TiptapNode, type Attributes, type Editor } from '@tiptap/core'
import { CodeBlock } from '@tiptap/extension-code-block'
import { OrderedList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'
import { closeHistory } from '@tiptap/pm/history'
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { canJoin } from '@tiptap/pm/transform'
import { ElButton, ElDialog, ElInput, ElMessage } from 'element-plus'
import 'element-plus/es/components/dialog/style/css'
import 'element-plus/es/components/input/style/css'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/message/style/css'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import WordComments from './WordComments.vue'
import WordRulers from '../WordRulers/WordRulers.vue'
import WordEditorContextMenu from './WordEditorContextMenu.vue'
import WordTableInsertControls from './WordTableInsertControls.vue'
import WordTableResizeControls from './WordTableResizeControls.vue'
import TableBordersDialog from './TableBordersDialog.vue'
import TableColumnSettingsDialog from './TableColumnSettingsDialog.vue'
import {
  BlockFontSize, InlineTextStyle, parseFontSize, readSelectionFontSize, setFontSizeAtCursor, setFontSizeInCells,
} from './blockFontSize'
import { isEmptyCell, ProtectRuledCells, readCellLine, type CellLine, type CellLineState } from './cellLines'
import { DocumentComment, retainCommentDraftOnMove, setContentWithComments } from './documentComments'
import {
  createBlankDocument, currentSection, DocumentSection, documentLayout, documentPageElements, emptyPage, forEachDocumentPage,
  newSectionId, pageAtPosition, sectionBlockBoundary, sectionControls, sectionLabel,
  type PageEntry, type SectionAction, type SectionStatus,
} from './documentSections'
import { DocumentHeading, isHeadingLevel, type DocumentBlockStyle } from './documentHeading'
import {
  DocumentNumbering, HeadingNumber, NumberedParagraph, readBlockNumbering, readNumberingGap,
} from './documentNumbering'
import {
  DocumentTable, DocumentTableCell, DocumentTableRow, PreventNestedTables,
  readTableColumnWidths, readTableIndent, tableAtSelection,
  type TableCellAlignment, type TableCellAlignmentState,
} from './documentTable'
import { inlineFormatCommands, type InlineFormat, type InlineFormatState } from './inlineFormatting'
import { readLocalDocument } from './localDocument'
import {
  cellAtPosition, cellTextBox, readTableRuler, resizeTableColumns, resizeTableColumnsFromPixels,
  type ColumnResizeTarget, type TableRulerContext,
} from './tableRuler'
import { readTableBorders, sameTableBorders, type TableBorders } from './tableBorders'
import type { TableColumnLayout, TableColumnSettings } from './tableColumnLayout'
import { isValidTableSize, type TableSize } from './tableSize'
import {
  DEFAULT_PAGE_MARGINS, fitPageMargins, marginValue, pageContentWidthCm, pageDimensions,
  readPageMargins, readPageOrientation, samePageMargins, validPageMargins, type PageMargins, type PageOrientation,
} from './pageGeometry'
import { adjustCellIndent, adjustIndent, indentDefaults, type IndentHandle, type ParagraphIndent } from '../WordRulers/paragraphIndent'

defineOptions({ name: 'WordEditor' })

const emit = defineEmits<{
  sectionChange: [status: SectionStatus]
  blockStyleChange: [style: DocumentBlockStyle | null]
  blockFontSizeChange: [size: number | null, available: boolean]
  inlineFormatsChange: [formats: InlineFormatState]
  pageOrientationChange: [orientation: PageOrientation]
  pageMarginsChange: [margins: PageMargins]
  tableInsertionAvailabilityChange: [available: boolean]
  tableNumberedChange: [numbered: boolean | null]
  tableCellAlignmentChange: [state: TableCellAlignmentState]
  tableCellLineChange: [state: CellLineState]
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

type MarginKey = keyof PageMargins

const sectionStatus = ref<SectionStatus>({ number: 1, name: '', total: 1, canSplit: true })
const sectionRenameId = ref<string | null>(null)
const sectionRenameVisible = ref(false)
const sectionNameDraft = ref('')
const sectionNameInput = ref<InstanceType<typeof ElInput> | null>(null)
const pendingSectionName = ref<string | null>(null)
const currentPageNumber = ref(1)
const currentPageMargins = ref<PageMargins>({ ...DEFAULT_PAGE_MARGINS })
const currentPageDimensions = ref(pageDimensions('portrait'))
const currentPageOffset = ref(0)
const documentWidth = ref(currentPageDimensions.value.width)
const commentLaneVisible = ref(false)
let layoutDoc: ProseMirrorNode | undefined
let pageOrientations: PageOrientation[] = []
const paragraphIndent = ref<ParagraphIndent | null>(null)
const paragraphNumberGap = ref<number>()
const tableBordersDialog = ref<InstanceType<typeof TableBordersDialog> | null>(null)
let tableBordersTarget: { position: number; node: ProseMirrorNode } | null = null
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
            if (!value) return {}
            return { [attribute]: value, style: `${property}: ${value}cm` }
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
  paragraphNumberGap.value = next && readBlockNumbering($head.parent)
    ? readNumberingGap(instance.view, $head.before()) : undefined
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

const readCellLineState = (selection: Selection): CellLineState => {
  const result: CellLineState = { available: false, line: null, canRemove: false }
  forEachCellAtSelection(selection, cell => {
    const line = readCellLine(cell.attrs.cellLine)
    if (!result.available) result.line = line
    else if (result.line !== line) result.line = null
    result.canRemove ||= line !== null
    result.available = true
  })
  return result
}

const syncTableTools = (instance: Editor) => {
  const { state } = instance
  const table = tableAtSelection(state.selection)
  emit('tableCellAlignmentChange', readTableCellAlignment(state.selection))
  emit('tableCellLineChange', readCellLineState(state.selection))
  emit('tableInsertionAvailabilityChange', !table)
  emit('tableNumberedChange', table ? table.node.attrs.isNumbered === true : null)
  refreshTableRuler()
}

const pageMarginsFromNode = (node: ProseMirrorNode) => readPageMargins(node.attrs)

const readPageOffset = (instance: Editor, position: number) => {
  const firstPagePosition = documentLayout(instance.state.doc).pages[0]?.pos
  const firstPage = firstPagePosition === undefined ? null : instance.view.nodeDOM(firstPagePosition)
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
    forEachDocumentPage(doc, (node) => {
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
  const isWrapper = (node: ProseMirrorNode) => node.type.name === 'page' || node.type.name === 'section'
  const unwrap = (node: ProseMirrorNode): ProseMirrorNode[] =>
    isWrapper(node) ? node.children.flatMap(unwrap) : [node]
  const openDepth = (node: ProseMirrorNode | null, depth: number, end: boolean): number =>
    node && depth > 0 && isWrapper(node) ? 1 + openDepth(end ? node.lastChild : node.firstChild, depth - 1, end) : 0

  if (!slice.content.content.some(isWrapper)) return slice
  return new Slice(
    Fragment.fromArray(slice.content.content.flatMap(unwrap)),
    slice.openStart - openDepth(slice.content.firstChild, slice.openStart, false),
    slice.openEnd - openDepth(slice.content.lastChild, slice.openEnd, true),
  )
}

const PaginatedDocument = TiptapNode.create({
  name: 'doc',
  topNode: true,
  content: 'section+',
  addCommands() {
    return { setContent: setContentWithComments }
  },
  addAttributes() {
    return { commentThreads: { default: [], rendered: false } }
  },
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
        if (pageIndex === 0) return $from.index(pageDepth - 2) > 0

        const current = $from.node(pageDepth)
        const previous = $from.node(pageDepth - 1).child(pageIndex - 1)
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

          const requestRun = (...indexes: number[]) => {
            indexes.forEach((index) => {
              if (index >= 0) dirtyPages.add(index)
            })

            if (animationFrame === null && !destroyed) {
              animationFrame = window.requestAnimationFrame(run)
            }
          }

          const nextInSection = (entries: PageEntry[], index: number) => {
            const next = entries[index + 1]
            return next?.section === entries[index]?.section ? next : undefined
          }

          // A page insertion/removal shifts queued indices in later sections.
          const shiftQueuedPages = (after: number, delta: number) => {
            for (const queue of [dirtyPages, backwardFlowPages]) {
              const shifted = [...queue].map(index => index > after ? index + delta : index)
              queue.clear()
              shifted.forEach(index => queue.add(index))
            }
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
            retainCommentDraftOnMove(transaction, from, to, destination)
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
            const next = nextInSection(entries, pageIndex)
            // A blank paragraph still occupies a line and may hold the caret after Enter.
            if (!next || next.node.childCount !== 0) return false

            const transaction = editorView.state.tr.delete(
              next.pos,
              next.pos + next.node.nodeSize,
            )
            dirtyPages.delete(pageIndex + 1)
            backwardFlowPages.delete(pageIndex + 1)
            shiftQueuedPages(pageIndex, -1)
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
            const next = nextInSection(entries, pageIndex)
            const transaction = editorView.state.tr.delete(movingFrom, movingTo)
            let destination: number

            if (next) {
              destination = transaction.mapping.map(next.pos + 1)
              transaction.insert(destination, movingContent)
            } else {
              const pageType = editorView.state.schema.nodes.page
              if (!pageType) return false

              const newPage = pageType.create(fitPageMargins(pageMarginsFromNode(current.node), 'portrait'), movingContent)
              shiftQueuedPages(pageIndex, 1)
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
            elements: ArrayLike<HTMLElement>,
          ) => {
            const current = entries[pageIndex]
            const next = nextInSection(entries, pageIndex)
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
            const lastElement = currentContent.lastElementChild as HTMLElement | null
            const occupiedBottom = lastElement ? outerBlockBottom(lastElement) : contentTop
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
            const insertAt = current.pos + 1 + current.node.content.size

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

            const entries = documentLayout(editorView.state.doc).pages
            const elements = documentPageElements(editorView.dom)
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

          requestRun(...documentLayout(editorView.state.doc).pages.map(page => page.index))

          return {
            update(view, previousState) {
              if (internalDispatch || view.state.doc.content.eq(previousState.doc.content)) return

              const previous = documentLayout(previousState.doc)
              const current = documentLayout(view.state.doc)
              const oldPages = new Map(previous.pages.map(page => [page.node, page]))
              const newPages = new Map(current.pages.map(page => [page.node, page]))
              // Retain scheduled work by section and local page if a document command shifted it.
              for (const queue of [dirtyPages, backwardFlowPages]) {
                const pending = [...queue]
                queue.clear()
                for (const index of pending) {
                  const oldPage = previous.pages[index]
                  const section = oldPage && current.byId.get(oldPage.section.id)
                  const retained = oldPage && newPages.get(oldPage.node)
                  if (retained) queue.add(retained.index)
                  else if (section && oldPage.localIndex < section.node.childCount) {
                    queue.add(section.firstPage + oldPage.localIndex)
                  }
                }
              }

              const reflowAround = (page: PageEntry) => {
                dirtyPages.add(page.index)
                backwardFlowPages.add(page.index)
                if (page.localIndex > 0) {
                  dirtyPages.add(page.index - 1)
                  backwardFlowPages.add(page.index - 1)
                }
              }
              for (const page of current.pages) {
                const predecessor = current.pages[page.index - 1]
                const oldSection = previous.byId.get(page.section.id)
                const oldPage = oldPages.get(page.node)
                const oldPredecessor = predecessor && oldPages.get(predecessor.node)
                if (!oldPage ||
                    (page.localIndex > 0 && oldPredecessor && oldPage.section !== oldPredecessor.section) ||
                    (oldSection && page.localIndex === page.section.node.childCount - 1
                      && page.section.node.childCount < oldSection.node.childCount)) {
                  reflowAround(page)
                }
              }
              requestRun()
            },
美少女·抓宠·大世界，我全都要！参与活动赢iPhone、PS5等惊喜大奖
https://azurpromilia美少女.manjuu.com/?utm_campaign=SHARE&utm_source=PGCPSH&inviteCode=LHHBMNR4#explore
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
  marks: 'comment',
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
    StarterKit.configure({ document: false, paragraph: false, heading: false, codeBlock: false, orderedList: false }),
    NumberedParagraph,
    OrderedList.extend({ addInputRules: () => [] }),
    TableKit.configure({
      table: false,
      tableCell: false,
      tableHeader: false,
      tableRow: false,
    }),
    DocumentTable,
    DocumentTableCell,
    DocumentTableRow,
    PreventNestedTables,
    ProtectRuledCells,
    DocumentCodeBlock,
    DocumentHeading,
    HeadingNumber,
    BlockIndentation,
    DocumentNumbering,
    BlockFontSize,
    InlineTextStyle,
    DocumentComment,
    PaginatedDocument,
    DocumentSection,
    sectionControls((id) => openSectionRename(id)),
    Page,
    Pagination,
  ],
  content: createBlankDocument(),
  onBeforeCreate: ({ editor: instance }) => {
    try {
      const saved = readLocalDocument(instance.schema)
      if (saved) instance.setOptions({ content: saved })
    } catch {
      ElMessage.warning('无法读取已保存的文档，已打开空白页。')
    }
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
    syncSection(editorInstance)
    syncBlockIndent(editorInstance)
    syncBlockStyle(editorInstance)
    syncInlineFormats(editorInstance)
    syncTableTools(editorInstance)
  },
  onTransaction: ({ editor: editorInstance }) => {
    syncCurrentPage(editorInstance)
    syncSection(editorInstance)
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
  const transaction = resizeTableColumnsFromPixels(instance.state, active.start - 1, table, widths)
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
  if (!parent.canReplaceWith(index, index + 1, target, block.marks) ||
      !target.validContent(block.content)) return

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
    const numberGap = readBlockNumbering(node) ? readNumberingGap(view, pos) : undefined
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
      after = adjustCellIndent(before, handle, delta, cellWidth, numberGap)
    } else {
      after = adjustIndent(before, handle, delta, (width - marginLeft - marginRight) / 10, marginLeft / 10, marginRight / 10, numberGap)
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

const showTableBorders = () => {
  const instance = editor.value
  const dialog = tableBordersDialog.value
  if (!instance || !dialog) return
  const table = tableAtSelection(instance.state.selection)
  if (!table) return

  tableBordersTarget = { position: table.start - 1, node: table.node }
  dialog.show(readTableBorders(table.node.attrs.borders))
}

const applyTableBorders = (draft: TableBorders) => {
  const instance = editor.value
  const target = tableBordersTarget
  if (!instance || !target) return false
  const { state, view } = instance
  const { position, node } = target
  if (state.doc.nodeAt(position) !== node) return false

  const borders = readTableBorders(draft)
  if (!sameTableBorders(readTableBorders(node.attrs.borders), borders)) {
    view.dispatch(closeHistory(state.tr.setNodeAttribute(position, 'borders', borders)))
  }
  return true
}

const closeTableBorders = () => {
  tableBordersTarget = null
  const instance = editor.value
  if (instance && !instance.isDestroyed) instance.view.focus()
}

const setTableCellLine = (line: CellLine | null) => {
  const instance = editor.value
  if (!instance) return
  const { state, view } = instance
  const transaction = state.tr
  let hasContent = false
  forEachCellAtSelection(state.selection, (cell, position) => {
    if (line && !isEmptyCell(cell)) hasContent = true
    if (cell.attrs.cellLine !== line) transaction.setNodeAttribute(position, 'cellLine', line)
  })
  if (hasContent) {
    ElMessage.warning({ message: '画线只适用于空单元格，选区中有内容。', grouping: true })
    return
  }

  if (transaction.docChanged) view.dispatch(closeHistory(transaction))
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
  return page ? pageContentWidthCm(page.node.attrs) : null
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

  const indentLeft = readTableIndent(table.node.attrs.indentLeft)
  const widths = readTableColumnWidths(table.node)
  if (!widths.length) return
  if (indentLeft >= availableWidth) widths.fill(0)

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

  const transaction = resizeTableColumns(state, position, node, layout.widths) ?? state.tr
  if (layout.indentLeft !== settings.layout.indentLeft) {
    transaction.setNodeAttribute(position, 'indentLeft', layout.indentLeft)
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

const syncSection = (instance: Editor) => {
  const section = currentSection(instance)
  if (!section) return
  const status = {
    number: section.index + 1,
    name: String(section.node.attrs.name ?? ''),
    total: documentLayout(instance.state.doc).sections.length,
    canSplit: sectionBlockBoundary(instance.state.selection.$head) !== null,
  }
  const previous = sectionStatus.value
  if (status.number === previous.number && status.name === previous.name &&
      status.total === previous.total && status.canSplit === previous.canSplit) return
  sectionStatus.value = status
  emit('sectionChange', status)
}

const openSectionRename = (id: string) => {
  const instance = editor.value
  const section = instance && documentLayout(instance.state.doc).byId.get(id)
  if (!section) return
  sectionRenameId.value = id
  sectionNameDraft.value = String(section.node.attrs.name ?? '')
  pendingSectionName.value = null
  sectionRenameVisible.value = true
}

const confirmSectionRename = () => {
  pendingSectionName.value = sectionNameDraft.value.trim()
  sectionRenameVisible.value = false
}

const finishSectionRename = () => {
  const instance = editor.value
  const id = sectionRenameId.value
  const name = pendingSectionName.value
  sectionRenameId.value = null
  pendingSectionName.value = null
  if (!instance || !id || name === null) return
  const section = documentLayout(instance.state.doc).byId.get(id)
  if (section && name !== section.node.attrs.name) {
    instance.view.dispatch(closeHistory(instance.state.tr.setNodeAttribute(section.pos, 'name', name)))
  }
}

const runSectionAction = (action: SectionAction) => {
  const instance = editor.value
  if (!instance) return
  const { state, view } = instance
  const section = currentSection(instance)
  const sectionType = state.schema.nodes.section
  if (!section || !sectionType) return
  if (action === 'rename') {
    openSectionRename(section.id)
    return
  }

  const tr = closeHistory(state.tr)
  let focus: number
  if (action === 'merge') {
    if (section.index === 0 || !canJoin(tr.doc, section.pos)) return
    tr.join(section.pos)
    focus = tr.mapping.map(state.selection.head)
  } else {
    const page = pageAtPosition(state.doc, state.selection.head)
    const attributes = { id: newSectionId(), name: '' }
    const after = section.pos + section.node.nodeSize

    if (action === 'insert') {
      tr.insert(after, sectionType.create(attributes, emptyPage(state.doc, section.node.lastChild)))
      focus = after + 2
    } else {
      const boundary = sectionBlockBoundary(state.selection.$head)
      if (!page || boundary === null) return
      const localOffset = boundary - page.pos - 1
      const left = section.node.children.slice(0, page.localIndex)
      if (localOffset > 0) left.push(page.node.copy(page.node.content.cut(0, localOffset)))
      if (!left.length) left.push(emptyPage(state.doc, page.node))
      const right = [page.node.copy(page.node.content.cut(localOffset)), ...section.node.children.slice(page.localIndex + 1)]
      const previous = section.node.copy(Fragment.fromArray(left))
      const next = sectionType.create(attributes, right)
      tr.replaceWith(section.pos, after, [previous, next])
      focus = section.pos + previous.nodeSize + 2
      retainCommentDraftOnMove(tr, boundary, after - 1, focus)
    }
  }

  tr.setSelection(Selection.near(tr.doc.resolve(focus)))
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

const toggleInlineFormat = (format: InlineFormat) => {
  const instance = editor.value
  if (!instance) return
  instance.chain().focus()[inlineFormatCommands[format]]().run()
}

defineExpose({
  getJSON, undo, redo, runSectionAction, setBlockStyle, setBlockFontSize, toggleInlineFormat,
  setCurrentPageOrientation, setCurrentPageMargins, insertTable,
  toggleTableNumbered, showTableBorders, showTableColumnSettings, alignTableCells, setTableCellLine,
})
</script>

<template>
  <div
    class="word-editor-canvas"
    :class="{
      'is-ribbon-panel-pinned': ribbonPanelPinned,
      'is-table-gridlines-hidden': !showTableGridlines,
      'has-comment-lane': commentLaneVisible,
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
      :paragraph-number-gap="paragraphNumberGap"
      :table-ruler="columnResizeRuler?.context ?? tableRuler"
      :column-resize-preview="rulerColumnPreview"
      @column-resize="updateTableColumns"
      @table-indent-change="updateTableIndent"
      @margin-change="updateCurrentPageMargin"
      @indent-change="updateBlockIndent"
    />

    <main class="document-workspace">
      <EditorContent v-if="editor" :editor="editor" class="paginated-editor" />
      <WordComments v-if="editor" :editor="editor" @lane-change="commentLaneVisible = $event" />
    </main>
    <div class="word-section-status" :title="sectionLabel(sectionStatus.number, sectionStatus.name)">
      <span>{{ sectionLabel(sectionStatus.number, sectionStatus.name) }}</span>
      <span>共 {{ sectionStatus.total }} 节</span>
    </div>
    <ElDialog
      v-model="sectionRenameVisible"
      title="重命名节"
      width="min(400px, calc(100vw - 32px))"
      align-center
      append-to-body
      :close-on-click-modal="false"
      @opened="sectionNameInput?.select()"
      @closed="finishSectionRename"
    >
      <ElInput
        ref="sectionNameInput"
        v-model="sectionNameDraft"
        aria-label="节名称"
        placeholder="节名称"
        @keydown.enter.prevent="confirmSectionRename"
      />
      <template #footer>
        <ElButton @click="sectionRenameVisible = false">取消</ElButton>
        <ElButton type="primary" @click="confirmSectionRename">确定</ElButton>
      </template>
    </ElDialog>
    <TableBordersDialog ref="tableBordersDialog" :apply="applyTableBorders" @closed="closeTableBorders" />
    <TableColumnSettingsDialog
      ref="tableColumnDialog"
      :apply="applyTableColumnSettings"
      @closed="closeTableColumnSettings"
    />
    <WordEditorContextMenu v-if="editor" :editor="editor" />
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
