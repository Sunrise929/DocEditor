<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { ElButton, ElInput } from 'element-plus'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/input/style/css'
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, type ComponentPublicInstance } from 'vue'
import {
  activateComment, cancelCommentDraft, publishComment, readCommentIndex,
  readCommentThreads, readCommentView, replyToComment, type CommentAnchor, type CommentThread,
} from './documentComments'

import { documentPageElements, pageAtPosition } from './documentSections'

const props = defineProps<{ editor: Editor }>()
const emit = defineEmits<{ laneChange: [visible: boolean] }>()

type Card = { key: string; left: number; top: number; thread?: CommentThread }
type Candidate = CommentAnchor & { key: string; thread?: CommentThread }
const cards = shallowRef<Card[]>([])
const activeId = ref<string | null>(null)
const layer = useTemplateRef<HTMLElement>('layer')
const draftBody = ref('')
const replyBody = ref('')
const replyingTo = ref<string | null>(null)
const cardElements = new Map<string, HTMLElement>()
let resizeObserver: ResizeObserver | undefined
let frame = 0
let laneVisible = false
let draftOpen = false
let focusDraft = false
let destroyed = false

const setCardElement = (key: string, element: Element | ComponentPublicInstance | null) => {
  const previous = cardElements.get(key)
  if (previous === element) return
  if (previous) resizeObserver?.unobserve(previous)
  if (element instanceof HTMLElement) {
    cardElements.set(key, element)
    resizeObserver?.observe(element)
  } else cardElements.delete(key)
}

const formatTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
const threadKey = (id: string) => 'thread:' + id

const revealPosition = (pos: number) => {
  const { node } = props.editor.view.domAtPos(pos, 1)
  const element = node instanceof HTMLElement ? node : node.parentElement
  element?.scrollIntoView({ block: 'center', inline: 'nearest' })
}

const visiblePages = (pages: NodeListOf<HTMLElement>) => {
  const top = -window.innerHeight
  const bottom = 2 * window.innerHeight
  let low = 0
  let high = pages.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (pages[middle]!.getBoundingClientRect().bottom < top) low = middle + 1
    else high = middle
  }
  const visible = new Map<number, DOMRect>()
  for (let index = low; index < pages.length; index++) {
    const bounds = pages[index]!.getBoundingClientRect()
    if (bounds.top > bottom) break
    visible.set(index, bounds)
  }
  return visible
}

const measure = () => {
  frame = 0
  if (!layer.value || props.editor.isDestroyed) return
  const { state, view } = props.editor
  const { draft } = readCommentView(state)
  const threads = readCommentThreads(state.doc)
  const index = draft || threads.length ? readCommentIndex(state.doc) : null
  const shouldShow = Boolean(draft || threads.some(thread => index?.anchors.has(thread.id)))
  if (laneVisible !== shouldShow) {
    laneVisible = shouldShow
    emit('laneChange', shouldShow)
    requestMeasure()
    return
  }
  if (!index || !shouldShow) {
    if (cards.value.length) cards.value = []
    return
  }

  const pages = visiblePages(documentPageElements(view.dom))
  const threadsById = new Map(threads.map(thread => [thread.id, thread]))
  const candidates: Candidate[] = []
  for (const page of pages.keys()) {
    for (const anchor of index.byPage.get(page) ?? []) {
      const thread = threadsById.get(anchor.id)
      if (thread) candidates.push({ ...anchor, key: threadKey(thread.id), thread })
    }
  }

  if (draft) {
    const page = pageAtPosition(state.doc, draft.from)?.index
    if (page !== undefined && pages.has(page)) candidates.push({ id: '', key: 'draft', pos: draft.from, page })
    else if (focusDraft) {
      revealPosition(draft.from)
      requestMeasure()
    }
  }
  candidates.sort((first, second) => first.pos - second.pos)
  const origin = layer.value.getBoundingClientRect()
  let nextTop = -Infinity
  cards.value = candidates.flatMap(candidate => {
    const page = pages.get(candidate.page)
    if (!page) return []
    const firstLine = view.coordsAtPos(candidate.pos, 1)
    const top = Math.max(firstLine.top - origin.top, nextTop)
    const height = cardElements.get(candidate.key)?.offsetHeight ?? 112
    nextTop = top + height + 8
    return [{ key: candidate.key, thread: candidate.thread, left: page.right - origin.left + 12, top }]
  })
  if (focusDraft && cards.value.some(card => card.key === 'draft')) {
    focusDraft = false
    void nextTick(() => {
      const card = cardElements.get('draft')
      card?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      card?.querySelector('textarea')?.focus({ preventScroll: true })
    })
  }
}

const requestMeasure = () => {
  if (!frame && !destroyed) frame = requestAnimationFrame(measure)
}

const onTransaction = () => {
  const { draft, activeId: active } = readCommentView(props.editor.state)
  activeId.value = active
  if (draft && !draftOpen) {
    draftBody.value = ''
    focusDraft = true
  }
  draftOpen = draft !== null
  if (!draftOpen) focusDraft = false
  requestMeasure()
}

const onScroll = () => {
  if (laneVisible) requestMeasure()
}

const goToComment = (id: string) => {
  const anchor = readCommentIndex(props.editor.state.doc).anchors.get(id)
  if (!anchor) return
  activateComment(props.editor, id)
  revealPosition(anchor.pos)
}

const onTextClick = (event: MouseEvent) => {
  if (!(event.target instanceof Element)) return
  const id = event.target.closest('[data-comment-thread]')?.getAttribute('data-comment-thread')
  if (!id || !readCommentThreads(props.editor.state.doc).some(thread => thread.id === id)) return
  activateComment(props.editor, id)
  cardElements.get(threadKey(id))?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

const submitDraft = () => {
  if (publishComment(props.editor, draftBody.value)) draftBody.value = ''
}

const openReply = async (id: string) => {
  activateComment(props.editor, id)
  if (replyingTo.value !== id) replyBody.value = ''
  replyingTo.value = id
  await nextTick()
  cardElements.get(threadKey(id))?.querySelector('textarea')?.focus({ preventScroll: true })
}

const submitReply = (id: string) => {
  if (!replyToComment(props.editor, id, replyBody.value)) return
  replyBody.value = ''
  replyingTo.value = null
}

onMounted(() => {
  const { editor } = props
  editor.on('transaction', onTransaction)
  editor.view.dom.addEventListener('click', onTextClick)
  window.addEventListener('scroll', onScroll, { capture: true, passive: true })
  window.addEventListener('resize', requestMeasure)
  resizeObserver = new ResizeObserver(requestMeasure)
  resizeObserver.observe(editor.view.dom)
  onTransaction()
})

onBeforeUnmount(() => {
  destroyed = true
  cancelAnimationFrame(frame)
  resizeObserver?.disconnect()
  props.editor.off('transaction', onTransaction)
  if (!props.editor.isDestroyed) props.editor.view.dom.removeEventListener('click', onTextClick)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', requestMeasure)
})
</script>

<template>
  <aside ref="layer" class="word-comments-layer" aria-label="文档批注">
    <article
      v-for="card in cards"
      :key="card.key"
      :ref="element => setCardElement(card.key, element)"
      class="word-comment-card"
      :class="{ 'is-active': !card.thread || card.thread.id === activeId }"
      :data-comment-card="card.thread?.id ?? 'draft'"
      :style="{ left: card.left + 'px', top: card.top + 'px' }"
    >
      <template v-if="card.thread">
        <div class="word-comment-thread" @click="goToComment(card.thread.id)">
          <button type="button" class="word-comment-heading" @click.stop="goToComment(card.thread.id)">
            批注 <time>{{ formatTime.format(card.thread.createdAt) }}</time>
          </button>
          <p>{{ card.thread.body }}</p>
          <div v-for="reply in card.thread.replies" :key="reply.id" class="word-comment-reply">
            <div class="word-comment-heading">回复 <time>{{ formatTime.format(reply.createdAt) }}</time></div>
            <p>{{ reply.body }}</p>
          </div>
        </div>
        <form v-if="replyingTo === card.thread.id" class="word-comment-form" @submit.prevent="submitReply(card.thread.id)">
          <ElInput v-model="replyBody" type="textarea" :rows="2" aria-label="回复内容" placeholder="输入回复" />
          <div class="word-comment-actions">
            <ElButton size="small" @click="replyingTo = null">取消</ElButton>
            <ElButton size="small" type="primary" native-type="submit" :disabled="!replyBody.trim()">发布</ElButton>
          </div>
        </form>
        <div v-else class="word-comment-actions">
          <ElButton size="small" text @click="openReply(card.thread.id)">回复</ElButton>
        </div>
      </template>
      <form v-else class="word-comment-form" @submit.prevent="submitDraft">
        <div class="word-comment-heading">新建批注</div>
        <ElInput v-model="draftBody" type="textarea" :rows="2" aria-label="批注内容" placeholder="输入批注" />
        <div class="word-comment-actions">
          <ElButton size="small" @click="cancelCommentDraft(editor)">取消</ElButton>
          <ElButton size="small" type="primary" native-type="submit" :disabled="!draftBody.trim()">发布</ElButton>
        </div>
      </form>
    </article>
  </aside>
</template>

<style scoped>
.word-comments-layer {
  position: absolute;
  z-index: 1;
  inset: 0;
  pointer-events: none;
}

.word-comment-card {
  position: absolute;
  display: grid;
  width: var(--word-comment-card-width);
  padding: 10px;
  gap: 7px;
  border: 1px solid #d8dce3;
  border-radius: 7px;
  background: #fff;
  box-shadow: 0 2px 5px rgb(15 23 42 / 10%);
  color: #273142;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
  pointer-events: auto;
}

.word-comment-card.is-active {
  border-color: #6694cc;
}

.word-comment-thread {
  max-height: 190px;
  overflow-y: auto;
  cursor: pointer;
}

.word-comment-heading {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  text-align: left;
}

button.word-comment-heading {
  cursor: pointer;
}

.word-comment-heading time {
  color: #687181;
  font-size: 11px;
  font-weight: 400;
}

.word-comment-card p {
  margin: 4px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.word-comment-reply {
  margin-top: 8px;
  padding: 7px 0 0 8px;
  border-top: 1px solid #edf0f4;
}

.word-comment-form {
  display: grid;
  gap: 7px;
}

.word-comment-actions {
  display: flex;
  justify-content: flex-end;
}

@media print {
  .word-comments-layer {
    display: none;
  }
}
</style>
