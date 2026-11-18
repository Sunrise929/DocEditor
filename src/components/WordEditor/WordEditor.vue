<script setup lang="ts">
import { Extension, mergeAttributes, Node as TiptapNode, type Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { canJoin } from '@tiptap/pm/transform'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { reactive, ref } from 'vue'
import WordRulers from '../WordRulers/WordRulers.vue'

defineOptions({ name: 'WordEditor' })

withDefaults(defineProps<{
  showRulers?: boolean
  ribbonPanelPinned?: boolean
}>(), {
  showRulers: true,
  ribbonPanelPinned: true,
})

type PageEntry = {
  node: ProseMirrorNode
  pos: number
}

type PageMargins = {
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
}

type MarginKey = keyof PageMargins

const DEFAULT_PAGE_MARGINS: PageMargins = {
  marginTop: 25,
  marginRight: 20,
  marginBottom: 25,
  marginLeft: 20,
}

const currentPageNumber = ref(1)
const currentPageMargins = reactive<PageMargins>({ ...DEFAULT_PAGE_MARGINS })

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

const syncCurrentPage = (editorInstance: Editor) => {
  const page = pageAtPosition(
    editorInstance.state.doc,
    editorInstance.state.selection.from,
  )
  if (!page) return

  currentPageNumber.value = page.index + 1
  Object.assign(currentPageMargins, pageMarginsFromNode(page.node))
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

    return [
      'section',
      mergeAttributes(HTMLAttributes, {
        class: 'document-page',
        'data-page': '',
        style: [
          `--page-margin-top: ${margins.marginTop}mm`,
          `--page-margin-right: ${margins.marginRight}mm`,
          `--page-margin-bottom: ${margins.marginBottom}mm`,
          `--page-margin-left: ${margins.marginLeft}mm`,
        ].join('; '),
      }),
      ['div', { class: 'page-content', 'data-page-content': '' }, 0],
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

          const splitOverflowingTextBlock = (
            pageIndex: number,
            entry: PageEntry,
            contentElement: HTMLElement,
          ) => {
            const { rect: contentRect, bottom: contentBottom } =
              contentBounds(contentElement)
            const childElements = Array.from(
              contentElement.children,
            ) as HTMLElement[]
            let childOffset = 0

            for (let index = 0; index < entry.node.childCount; index += 1) {
              const childNode = entry.node.child(index)
              const childElement = childElements[index]
              const childRect = childElement?.getBoundingClientRect()

              if (!childElement || !childRect) return false

              const crossesPageBottom =
                childRect.top < contentBottom - 2 &&
                childRect.bottom > contentBottom + 1

              if (!crossesPageBottom || !childNode.isTextblock) {
                childOffset += childNode.nodeSize
                continue
              }

              const childStyle = window.getComputedStyle(childElement)
              const positionAtBottom = editorView.posAtCoords({
                left: Math.min(childRect.right - 8, contentRect.right - 8),
                top: contentBottom - pixels(childStyle.marginBottom) - 4,
              })

              if (!positionAtBottom) return false

              const childNodeStart = entry.pos + 1 + childOffset
              const childNodeEnd = childNodeStart + childNode.nodeSize
              const splitPosition = positionAtBottom.pos

              if (
                splitPosition <= childNodeStart + 1 ||
                splitPosition >= childNodeEnd - 1
              ) {
                return false
              }

              try {
                dispatchPagination(editorView.state.tr.split(splitPosition))
                requestRun(pageIndex, pageIndex + 1)
                return true
              } catch {
                return false
              }
            }

            return false
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

            // Keep at least one block on every page. A block that is taller than
            // the printable area is split first by splitOverflowingTextBlock().
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

            if (next) {
              transaction.insert(
                transaction.mapping.map(next.pos + 1),
                movingContent,
              )
            } else {
              const pageType = editorView.state.schema.nodes.page
              if (!pageType) return false

              const newPage = pageType.create(current.node.attrs, movingContent)
              transaction.insert(
                transaction.mapping.map(current.pos + current.node.nodeSize),
                newPage,
              )
            }

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
            const candidateElements = Array.from(
              nextContent.children,
            ) as HTMLElement[]
            let movingSize = 0
            let usedHeight = 0

            for (
              let index = 0;
              index < next.node.childCount && index < candidateElements.length;
              index += 1
            ) {
              const element = candidateElements[index]
              const style = window.getComputedStyle(element)
              const blockHeight =
                element.getBoundingClientRect().height +
                Number.parseFloat(style.marginTop || '0') +
                Number.parseFloat(style.marginBottom || '0')

              if (usedHeight + blockHeight > availableHeight - 2) break

              usedHeight += blockHeight
              movingSize += next.node.child(index).nodeSize
            }

            if (movingSize === 0) {
              const candidateNode = next.node.firstChild
              const candidateElement = candidateElements[0]

              if (!candidateNode?.isTextblock || !candidateElement) return false

              const candidateStyle = window.getComputedStyle(candidateElement)
              const lineHeight =
                pixels(candidateStyle.lineHeight) ||
                pixels(candidateStyle.fontSize) * 1.75
              const usableHeight =
                availableHeight - pixels(candidateStyle.marginBottom) - 4

              if (usableHeight < lineHeight) return false

              const candidateRect = candidateElement.getBoundingClientRect()
              const nextRect = nextContent.getBoundingClientRect()
              const positionAtAvailableBottom = editorView.posAtCoords({
                left: Math.min(candidateRect.right - 8, nextRect.right - 8),
                top: Math.min(
                  candidateRect.bottom - 4,
                  candidateRect.top + usableHeight,
                ),
              })

              if (!positionAtAvailableBottom) return false

              const candidateStart = next.pos + 1
              const candidateEnd = candidateStart + candidateNode.nodeSize
              const splitPosition = positionAtAvailableBottom.pos

              if (
                splitPosition <= candidateStart + 1 ||
                splitPosition >= candidateEnd - 1
              ) {
                return false
              }

              try {
                dispatchPagination(editorView.state.tr.split(splitPosition))
                backwardFlowPages.add(pageIndex)
                backwardFlowPages.add(pageIndex + 1)
                requestRun(pageIndex, pageIndex + 1)
                return true
              } catch {
                return false
              }
            }

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
              if (
                splitOverflowingTextBlock(pageIndex, current, contentElement) ||
                moveOverflowForward(pageIndex, entries, contentElement)
              ) {
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

// Keep one ProseMirror instance for the whole document so 100+ pages do not
// create 100+ independent editors, histories, and event systems.
const editor = useEditor({
  extensions: [
    StarterKit.configure({ document: false }),
    PaginatedDocument,
    Page,
    Pagination,
  ],
  content: {
    type: 'doc',
    content: [
      {
        type: 'page',
        content: [{ type: 'paragraph' }],
      },
    ],
  },
  editorProps: {
    transformCopied: removePageWrappersFromClipboard,
    attributes: {
      class: 'document-root',
      spellcheck: 'true',
    },
  },
  onCreate: ({ editor: editorInstance }) => syncCurrentPage(editorInstance),
  onSelectionUpdate: ({ editor: editorInstance }) =>
    syncCurrentPage(editorInstance),
  onTransaction: ({ editor: editorInstance }) =>
    syncCurrentPage(editorInstance),
})

const updateCurrentPageMargin = (key: MarginKey, value: number) => {
  const editorInstance = editor.value
  if (!editorInstance) return

  const page = pageAtPosition(
    editorInstance.state.doc,
    editorInstance.state.selection.from,
  )
  if (!page) return

  const transaction = editorInstance.state.tr
    .setNodeMarkup(page.pos, undefined, {
      ...page.node.attrs,
      [key]: value,
    })
    .setMeta('addToHistory', false)

  editorInstance.view.dispatch(transaction)
  currentPageMargins[key] = value
}

const undo = () => {
  return editor.value?.chain().focus().undo().run() ?? false
}

const redo = () => {
  return editor.value?.chain().focus().redo().run() ?? false
}

const getJSON = () => editor.value?.getJSON()

defineExpose({ getJSON, undo, redo })
</script>

<template>
  <div
    class="word-editor-canvas"
    :class="{ 'is-ribbon-panel-pinned': ribbonPanelPinned }"
  >
    <WordRulers
      v-if="showRulers"
      :current-page-number="currentPageNumber"
      :margins="currentPageMargins"
      @margin-change="updateCurrentPageMargin"
    />

    <main class="document-workspace">
      <EditorContent v-if="editor" :editor="editor" class="paginated-editor" />
    </main>
  </div>
</template>

<style src="./WordEditor.css"></style>
