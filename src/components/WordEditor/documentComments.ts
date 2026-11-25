import { commands, Mark, type Editor, type RawCommands } from '@tiptap/core'
import { Fragment, Slice, type MarkType, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { forEachDocumentPage } from './documentSections'

type TextRange = { from: number; to: number }
type MovedRange = TextRange & { destination: number }

export type CommentMessage = { id: string; body: string; createdAt: number }
export type CommentThread = CommentMessage & { replies: CommentMessage[] }
export type CommentAnchor = { id: string; pos: number; page: number }
type CommentSpan = TextRange & { id: string }

type CommentViewState = {
  draft: TextRange | null
  activeId: string | null
}
type CommentMeta = Partial<CommentViewState> & { moved?: MovedRange }

const commentKey = new PluginKey<CommentViewState>('documentComments')
const initialState: CommentViewState = { draft: null, activeId: null }
export const readCommentView = (state: EditorState) => commentKey.getState(state) ?? initialState

const isMessage = (value: unknown): value is CommentMessage => {
  if (!value || typeof value !== 'object') return false
  const { id, body, createdAt } = value as Partial<CommentMessage>
  return typeof id === 'string' && typeof body === 'string'
    && typeof createdAt === 'number' && Number.isFinite(createdAt) && Math.abs(createdAt) <= 8.64e15
}

const threadCache = new WeakMap<object, CommentThread[]>()
export const readCommentThreads = (doc: { attrs?: Record<string, unknown> }): CommentThread[] => {
  const value = doc.attrs?.commentThreads
  if (!Array.isArray(value)) return []
  const cached = threadCache.get(value)
  if (cached) return cached
  const threads = value.filter((item): item is CommentThread =>
    isMessage(item) && 'replies' in item && Array.isArray(item.replies) && item.replies.every(isMessage))
  threadCache.set(value, threads)
  return threads
}

// Tiptap replaces the root's children in setContent. Load the saved root attribute in the same transaction.
export const setContentWithComments: RawCommands['setContent'] = (content, options) => props => {
  const applied = commands.setContent(content, options)(props)
  if (applied && props.dispatch) {
    const threads = content && typeof content === 'object' && 'attrs' in content ? readCommentThreads(content) : []
    const ids = new Set(threads.map(thread => thread.id))
    const { tr } = props
    tr.doc.descendants((node, pos) => {
      if (!node.isText) return
      for (const mark of node.marks) {
        if (mark.type.name === 'comment' && !ids.has(mark.attrs.threadId)) {
          tr.removeMark(pos, pos + node.nodeSize, mark)
        }
      }
    })
    tr.setDocAttribute('commentThreads', threads)
      .setMeta(commentKey, { draft: null, activeId: null } satisfies CommentMeta)
  }
  return applied
}

const pageSpans = new WeakMap<ProseMirrorNode, CommentSpan[]>()
const readPageSpans = (page: ProseMirrorNode) => {
  const cached = pageSpans.get(page)
  if (cached) return cached
  const spans: CommentSpan[] = []
  page.descendants((node, from) => {
    if (!node.isText) return
    for (const mark of node.marks) {
      const id: unknown = mark.attrs.threadId
      if (mark.type.name === 'comment' && typeof id === 'string' && id) {
        spans.push({ id, from, to: from + node.nodeSize })
      }
    }
  })
  pageSpans.set(page, spans)
  return spans
}

type CommentIndex = {
  anchors: Map<string, CommentAnchor>
  byPage: Map<number, CommentAnchor[]>
  spans: Map<string, TextRange[]>
}

// Comment edits change root attributes without changing page content.
const indexByContent = new WeakMap<Fragment, CommentIndex>()
export const readCommentIndex = (doc: ProseMirrorNode) => {
  const cached = indexByContent.get(doc.content)
  if (cached) return cached
  const index: CommentIndex = { anchors: new Map(), byPage: new Map(), spans: new Map() }
  forEachDocumentPage(doc, (page, offset, pageIndex) => {
    const anchors: CommentAnchor[] = []
    for (const span of readPageSpans(page)) {
      const from = offset + 1 + span.from
      const to = offset + 1 + span.to
      const ranges = index.spans.get(span.id)
      if (ranges) ranges.push({ from, to })
      else index.spans.set(span.id, [{ from, to }])
      if (index.anchors.has(span.id)) continue
      const anchor = { id: span.id, pos: from, page: pageIndex }
      anchors.push(anchor)
      index.anchors.set(span.id, anchor)
    }
    if (anchors.length) index.byPage.set(pageIndex, anchors)
  })
  indexByContent.set(doc.content, index)
  return index
}

const containsText = (doc: ProseMirrorNode, range: TextRange, type: MarkType) => {
  if (range.from >= range.to) return false
  let found = false
  doc.nodesBetween(range.from, range.to, (node, _pos, parent) => {
    if (found) return false
    found = node.isText && parent?.type.allowsMarkType(type) === true
  })
  return found
}

export const canStartComment = ({ selection, schema, doc }: EditorState) => {
  const type = schema.marks.comment
  return Boolean(type && selection instanceof TextSelection && !selection.empty && containsText(doc, selection, type))
}

export const startCommentDraft = (editor: Editor) => {
  const { state, view } = editor
  if (readCommentView(state).draft || !canStartComment(state)) return false
  const { from, to } = state.selection
  view.dispatch(state.tr.setMeta(commentKey, { draft: { from, to }, activeId: null } satisfies CommentMeta))
  return true
}

export const cancelCommentDraft = (editor: Editor) => {
  editor.view.dispatch(editor.state.tr.setMeta(commentKey, { draft: null } satisfies CommentMeta))
  editor.view.focus()
}

export const activateComment = (editor: Editor, id: string) => {
  const { state, view } = editor
  if (readCommentView(state).activeId !== id) {
    view.dispatch(state.tr.setMeta(commentKey, { activeId: id } satisfies CommentMeta))
  }
}

const createMessage = (body: string): CommentMessage => ({ id: crypto.randomUUID(), body: body.trim(), createdAt: Date.now() })

export const publishComment = (editor: Editor, body: string) => {
  const { view, state } = editor
  const { draft } = readCommentView(state)
  const type = state.schema.marks.comment
  if (!draft || !type || !body.trim() || !containsText(state.doc, draft, type)) return false
  const thread: CommentThread = { ...createMessage(body), replies: [] }
  const tr = state.tr.addMark(draft.from, draft.to, type.create({ threadId: thread.id }))
    .setDocAttribute('commentThreads', [...readCommentThreads(state.doc), thread])
    .setMeta(commentKey, { draft: null, activeId: thread.id } satisfies CommentMeta)
  view.dispatch(closeHistory(tr))
  return readCommentThreads(view.state.doc).some(item => item.id === thread.id)
}

export const replyToComment = (editor: Editor, id: string, body: string) => {
  if (!body.trim()) return false
  const { view, state } = editor
  const threads = readCommentThreads(state.doc)
  if (!threads.some(thread => thread.id === id)) return false
  const message = createMessage(body)
  const updated = threads.map(thread => thread.id === id
    ? { ...thread, replies: [...thread.replies, message] } : thread)
  view.dispatch(closeHistory(state.tr.setDocAttribute('commentThreads', updated)))
  return true
}

export const retainCommentDraftOnMove = (transaction: Transaction, from: number, to: number, destination: number) => {
  transaction.setMeta(commentKey, { moved: { from, to, destination } } satisfies CommentMeta)
}

const mapDraft = (draft: TextRange, tr: Transaction, moved?: MovedRange) => {
  const from = moved && draft.from >= moved.from && draft.from < moved.to
    ? moved.destination + draft.from - moved.from : tr.mapping.map(draft.from, 1)
  const to = moved && draft.to > moved.from && draft.to <= moved.to
    ? moved.destination + draft.to - moved.from : tr.mapping.map(draft.to, -1)
  const type = tr.doc.type.schema.marks.comment
  return type && containsText(tr.doc, { from, to }, type) ? { from, to } : null
}

export const DocumentComment = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  clearable: false,

  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: element => element.getAttribute('data-comment-thread'),
        renderHTML: attrs => ({ 'data-comment-thread': attrs.threadId }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-thread]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0]
  },

  addKeyboardShortcuts() {
    return { 'Mod-Alt-m': () => startCommentDraft(this.editor) }
  },

  addProseMirrorPlugins() {
    const type = this.type
    return [new Plugin<CommentViewState>({
      key: commentKey,
      state: {
        init: () => initialState,
        apply(tr, previous) {
          const meta = tr.getMeta(commentKey) as CommentMeta | undefined
          const draft = meta?.draft !== undefined ? meta.draft
            : previous.draft && tr.docChanged ? mapDraft(previous.draft, tr, meta?.moved) : previous.draft
          return { draft, activeId: meta?.activeId !== undefined ? meta.activeId : previous.activeId }
        },
      },
      props: {
        decorations(state) {
          const { activeId, draft } = readCommentView(state)
          const decorations: Decoration[] = []
          if (draft) decorations.push(Decoration.inline(draft.from, draft.to, { class: 'word-comment-draft-mark' }))
          if (activeId) {
            for (const { from, to } of readCommentIndex(state.doc).spans.get(activeId) ?? []) {
              decorations.push(Decoration.inline(from, to, { class: 'word-comment-active-mark' }))
            }
          }
          return DecorationSet.create(state.doc, decorations)
        },
        transformPasted(slice, view) {
          const ids = new Set(readCommentThreads(view.state.doc).map(thread => thread.id))
          const cleanNode = (node: ProseMirrorNode): ProseMirrorNode => {
            if (node.isText) {
              const marks = node.marks.filter(mark => mark.type !== type || ids.has(mark.attrs.threadId))
              return marks.length === node.marks.length ? node : node.mark(marks)
            }
            const children = node.children.map(cleanNode)
            return children.every((child, index) => child === node.child(index)) ? node : node.copy(Fragment.fromArray(children))
          }
          return new Slice(Fragment.fromArray(slice.content.content.map(cleanNode)), slice.openStart, slice.openEnd)
        },
      },
    })]
  },
})
