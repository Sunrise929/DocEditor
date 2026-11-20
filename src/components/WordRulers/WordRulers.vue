<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { adjustIndent, type IndentHandle, type ParagraphIndent } from './paragraphIndent'

defineOptions({ name: 'WordRulers' })

type PageMargins = {
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
}

type MarginKey = keyof PageMargins

const props = defineProps<{
  currentPageNumber: number
  margins: PageMargins
  paragraphIndent: ParagraphIndent | null
}>()

const emit = defineEmits<{
  marginChange: [key: MarginKey, value: number]
  indentChange: [handle: IndentHandle, delta: number]
}>()

const PAGE_WIDTH_MM = 210
const PAGE_HEIGHT_MM = 297
const MIN_CONTENT_WIDTH_MM = 20
const MIN_CONTENT_HEIGHT_MM = 5

const horizontalTicks = Array.from({ length: 85 }, (_, index) => index * 2.5)
const horizontalPageTicks = Array.from(
  { length: 169 },
  (_, index) => (index - 84) * 2.5,
)
const verticalTicks = Array.from({ length: 119 }, (_, index) => index * 2.5)
const verticalPageTicks = Array.from(
  { length: 241 },
  (_, index) => (index - 120) * 2.5,
)

const horizontalRuler = ref<HTMLElement | null>(null)
const verticalRuler = ref<HTMLElement | null>(null)

const indentHandles = [
  { key: 'first', label: '首行缩进' },
  { key: 'hanging', label: '悬挂缩进' },
  { key: 'left', label: '左缩进' },
  { key: 'right', label: '右缩进' },
] as const
const indentWidth = computed(() => (PAGE_WIDTH_MM - props.margins.marginLeft - props.margins.marginRight) / 10)
const indentDrag = ref<{ handle: IndentHandle; pointerId: number; startX: number; delta: number; precise: boolean; handleBottomOffset: number } | null>(null)
const indentGuideHeight = ref(0)
let replayDrag: ((precise: boolean) => void) | undefined

const changePrecision = (event: KeyboardEvent) => {
  if (event.key !== 'Alt' || !replayDrag) return
  event.preventDefault()
  if (!event.repeat) replayDrag(event.type === 'keydown')
}

const listenForPrecision = () => {
  window.addEventListener('keydown', changePrecision)
  window.addEventListener('keyup', changePrecision)
}

const stopPrecision = () => {
  replayDrag = undefined
  window.removeEventListener('keydown', changePrecision)
  window.removeEventListener('keyup', changePrecision)
}
const shownIndent = computed(() => {
  const indent = props.paragraphIndent
  const drag = indentDrag.value
  if (!indent || !drag) return indent
  return adjustIndent(
    indent, drag.handle, drag.delta, indentWidth.value,
    props.margins.marginLeft / 10, props.margins.marginRight / 10,
  )
})

const indentCoordinate = (handle: IndentHandle) => {
  const indent = shownIndent.value
  if (!indent) return 0
  const offset = handle === 'right' ? indentWidth.value - indent.indentRight
    : indent.indentLeft + (handle === 'first' ? indent.firstLineOffset : 0)
  return props.margins.marginLeft + offset * 10
}

const indentPosition = (handle: IndentHandle) =>
  percentage(indentCoordinate(handle), PAGE_WIDTH_MM)

const startIndentDrag = (handle: IndentHandle, event: PointerEvent) => {
  const ruler = horizontalRuler.value
  if (event.button !== 0 || indentDrag.value || marginGuide.value || !ruler) return
  event.preventDefault()
  const button = event.currentTarget as HTMLElement
  ruler.setPointerCapture(event.pointerId)
  indentDrag.value = {
    handle, pointerId: event.pointerId, startX: event.clientX, delta: 0, precise: event.altKey,
    handleBottomOffset: ruler.getBoundingClientRect().bottom - button.getBoundingClientRect().bottom,
  }
  listenForPrecision()
  window.addEventListener('blur', stopIndentDrag)
  moveIndentDrag(event)
}

const moveIndentDrag = (event: PointerEvent, precise = event.altKey) => {
  const drag = indentDrag.value
  const rect = horizontalRuler.value?.getBoundingClientRect()
  if (!drag || drag.pointerId !== event.pointerId || !rect?.width) return
  const bottom = rect.bottom - drag.handleBottomOffset
  indentGuideHeight.value = Math.max(0, document.documentElement.clientHeight - bottom)
  const direction = drag.handle === 'right' ? -1 : 1
  replayDrag = next => moveIndentDrag(event, next)
  drag.precise = precise
  const delta = direction * (event.clientX - drag.startX) / rect.width * (PAGE_WIDTH_MM / 10)
  drag.delta = precise ? delta : Math.round(delta * 4) / 4
}

const stopIndentDrag = () => {
  indentDrag.value = null
  stopPrecision()
  window.removeEventListener('blur', stopIndentDrag)
}

const finishIndentDrag = (event: PointerEvent) => {
  moveIndentDrag(event)
  const drag = indentDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  stopIndentDrag()
  if (drag.delta) emit('indentChange', drag.handle, drag.delta)
}

const cancelIndentDrag = (event: PointerEvent) => {
  if (indentDrag.value?.pointerId === event.pointerId) stopIndentDrag()
}

const verticalRulerPosition = computed(() => {
  const precedingPages = props.currentPageNumber - 1

  return {
    top: `calc(62px + ${precedingPages * PAGE_HEIGHT_MM}mm + ${precedingPages * 24}px)`,
  }
})

const percentage = (value: number, total: number) =>
  `${(value / total) * 100}%`

const isHorizontalBoundaryTick = (tick: number) => {
  const contentWidth =
    PAGE_WIDTH_MM - props.margins.marginLeft - props.margins.marginRight

  return Math.abs(tick) < 0.001 || Math.abs(tick - contentWidth) < 0.001
}

const isVerticalBoundaryTick = (tick: number) => {
  const contentHeight =
    PAGE_HEIGHT_MM - props.margins.marginTop - props.margins.marginBottom

  return Math.abs(tick) < 0.001 || Math.abs(tick - contentHeight) < 0.001
}

const verticalContentPercentage = (tick: number) => {
  const contentHeight =
    PAGE_HEIGHT_MM - props.margins.marginTop - props.margins.marginBottom

  return percentage(tick, contentHeight)
}

let removeMarginDragListeners: (() => void) | null = null
const marginGuide = ref<{ key: MarginKey; horizontal: boolean; length: number; precise: boolean } | null>(null)
const horizontalPrecision = computed(() =>
  Boolean(indentDrag.value?.precise || (marginGuide.value?.precise && marginGuide.value.horizontal)),
)
const verticalPrecision = computed(() => Boolean(marginGuide.value?.precise && !marginGuide.value.horizontal))

const precisionSegments = (horizontal: boolean) => {
  const total = horizontal ? PAGE_WIDTH_MM : PAGE_HEIGHT_MM
  const { marginLeft, marginRight, marginTop, marginBottom } = props.margins
  const start = horizontal ? marginLeft : marginTop
  const end = total - (horizontal ? marginRight : marginBottom)
  const marks = [0, total, start, end]
  if (horizontal && shownIndent.value) {
    marks.push(...indentHandles.map(handle => indentCoordinate(handle.key)))
  }
  const sortedMarks = marks
    .map(mark => Math.max(0, Math.min(total, mark)))
    .sort((a, b) => a - b)
  return sortedMarks.slice(1).flatMap((to, index) => {
    const from = sortedMarks[index]
    if (from === undefined || to - from < 0.001) return []
    return [{
      start: percentage(from, total),
      size: percentage(to - from, total),
      label: `${Number(((to - from) / 10).toFixed(2))}cm`,
    }]
  })
}

const marginGuidePosition = computed(() => {
  const guide = marginGuide.value
  if (!guide) return '0%'
  const total = guide.horizontal ? PAGE_WIDTH_MM : PAGE_HEIGHT_MM
  const margin = props.margins[guide.key]
  const farEdge = guide.key === 'marginRight' || guide.key === 'marginBottom'
  return percentage(farEdge ? total - margin : margin, total)
})

const stopMarginDrag = () => {
  removeMarginDragListeners?.()
  removeMarginDragListeners = null
  marginGuide.value = null
  stopPrecision()
}

const startMarginDrag = (key: MarginKey, event: PointerEvent) => {
  if (event.button !== 0 || indentDrag.value) return
  event.preventDefault()
  stopMarginDrag()

  const horizontal = key === 'marginLeft' || key === 'marginRight'
  const ruler = horizontal ? horizontalRuler.value : verticalRuler.value
  if (!ruler) return

  const move = (pointerEvent: PointerEvent, precise = pointerEvent.altKey) => {
    if (pointerEvent.pointerId !== event.pointerId) return
    const rect = ruler.getBoundingClientRect()
    const pageSize = horizontal ? PAGE_WIDTH_MM : PAGE_HEIGHT_MM
    const pointerPosition = horizontal
      ? pointerEvent.clientX - rect.left
      : pointerEvent.clientY - rect.top
    const rulerSize = horizontal ? rect.width : rect.height
    if (!rulerSize) return
    replayDrag = next => move(pointerEvent, next)
    const viewport = document.documentElement
    marginGuide.value = {
      key,
      horizontal,
      precise,
      length: Math.max(0, horizontal ? viewport.clientHeight - rect.bottom : viewport.clientWidth - rect.right),
    }
    const coordinate = Math.max(
      0,
      Math.min(pageSize, (pointerPosition / rulerSize) * pageSize),
    )
    const fromFarEdge = key === 'marginRight' || key === 'marginBottom'
    const rawMargin = fromFarEdge ? pageSize - coordinate : coordinate
    const oppositeMargin =
      key === 'marginLeft'
        ? props.margins.marginRight
        : key === 'marginRight'
          ? props.margins.marginLeft
          : key === 'marginTop'
            ? props.margins.marginBottom
            : props.margins.marginTop
    const minimumContentSize = horizontal
      ? MIN_CONTENT_WIDTH_MM
      : MIN_CONTENT_HEIGHT_MM
    const maximumMargin = pageSize - oppositeMargin - minimumContentSize
    const step = 2.5
    const desired = precise ? rawMargin : Math.round(rawMargin / step) * step
    const margin = Math.max(0, Math.min(maximumMargin, desired))
    if (margin !== props.margins[key]) emit('marginChange', key, margin)
  }

  const end = (pointerEvent: PointerEvent) => {
    if (pointerEvent.pointerId !== event.pointerId) return
    move(pointerEvent)
    stopMarginDrag()
  }

  const cancel = (pointerEvent: PointerEvent) => {
    if (pointerEvent.pointerId === event.pointerId) stopMarginDrag()
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('blur', stopMarginDrag)
  listenForPrecision()
  removeMarginDragListeners = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('blur', stopMarginDrag)
  }

  move(event)
}

onBeforeUnmount(() => {
  stopMarginDrag()
  stopIndentDrag()
})
</script>

<template>
  <div class="word-horizontal-ruler-shell">
    <span class="word-current-page-indicator">第 {{ currentPageNumber }} 页</span>
    <div
      ref="horizontalRuler"
      class="word-ruler word-horizontal-ruler"
      :class="{ 'is-precision': horizontalPrecision }"
      @pointermove="moveIndentDrag"
      @pointerup="finishIndentDrag"
      @pointercancel="cancelIndentDrag"
      @lostpointercapture="cancelIndentDrag"
    >
      <span
        class="word-ruler-margin-shade is-start"
        :style="{ width: percentage(margins.marginLeft, PAGE_WIDTH_MM) }"
      />
      <span
        class="word-ruler-margin-shade is-end"
        :style="{ width: percentage(margins.marginRight, PAGE_WIDTH_MM) }"
      />

      <span class="word-horizontal-ruler-page-ticks">
        <span
          v-for="tick in horizontalPageTicks"
          :key="tick"
          class="word-ruler-tick"
          :class="{
            'is-major': tick % 5 === 0,
            'is-boundary': isHorizontalBoundaryTick(tick),
          }"
          :style="{
            left: `calc(${percentage(margins.marginLeft, PAGE_WIDTH_MM)} + ${tick}mm)`,
          }"
        />
      </span>

      <span
        class="word-horizontal-ruler-scale"
        :style="{
          left: percentage(margins.marginLeft, PAGE_WIDTH_MM),
          right: percentage(margins.marginRight, PAGE_WIDTH_MM),
        }"
      >
        <span
          v-for="tick in horizontalTicks"
          :key="tick"
          class="word-ruler-tick"
          :class="{
            'is-major': tick % 5 === 0,
            'has-label': tick > 0 && tick % 10 === 0,
            'is-boundary': isHorizontalBoundaryTick(tick),
          }"
          :style="{ left: `${tick}mm` }"
        >
          <span
            v-if="tick > 0 && tick % 10 === 0 && !isHorizontalBoundaryTick(tick)"
            class="word-ruler-label"
          >{{ tick / 10 }}</span>
        </span>
      </span>

      <button
        type="button"
        class="word-ruler-boundary is-horizontal is-start"
        :style="{ left: percentage(margins.marginLeft, PAGE_WIDTH_MM) }"
        :aria-label="`调整第 ${currentPageNumber} 页左边距`"
        title="拖动调整左边距"
        @pointerdown="startMarginDrag('marginLeft', $event)"
      />
      <button
        type="button"
        class="word-ruler-boundary is-horizontal is-end"
        :style="{
          left: percentage(PAGE_WIDTH_MM - margins.marginRight, PAGE_WIDTH_MM),
        }"
        :aria-label="`调整第 ${currentPageNumber} 页右边距`"
        title="拖动调整右边距"
        @pointerdown="startMarginDrag('marginRight', $event)"
      />
      <span
        v-if="marginGuide?.horizontal"
        class="word-margin-guide is-down"
        :style="{ left: marginGuidePosition, height: `${marginGuide.length}px` }"
        aria-hidden="true"
      />
      <template v-if="horizontalPrecision">
        <span v-for="segment in precisionSegments(true)" :key="segment.start"
          class="word-ruler-measure is-horizontal"
          :style="{ left: segment.start, width: segment.size }">
          <span class="word-measure-arrow is-start" aria-hidden="true" />
          <span class="word-measure-label">{{ segment.label }}</span>
          <span class="word-measure-arrow is-end" aria-hidden="true" />
        </span>
      </template>
      <template v-if="shownIndent">
        <button
          v-for="handle in indentHandles"
          :key="handle.key"
          type="button"
          class="word-indent-handle"
          :class="`is-${handle.key}`"
          :style="{ left: indentPosition(handle.key) }"
          :aria-label="handle.label"
          :title="handle.label"
          @pointerdown="startIndentDrag(handle.key, $event)"
          @keydown.left.prevent="emit('indentChange', handle.key, handle.key === 'right' ? 0.25 : -0.25)"
          @keydown.right.prevent="emit('indentChange', handle.key, handle.key === 'right' ? -0.25 : 0.25)"
        >
          <span
            v-if="indentDrag?.handle === handle.key"
            class="word-indent-guide"
            :style="{ height: `${indentGuideHeight}px` }"
            aria-hidden="true"
          />
        </button>
      </template>
    </div>
  </div>

  <div class="word-vertical-ruler-shell" :style="verticalRulerPosition">
    <div ref="verticalRuler" class="word-ruler word-vertical-ruler"
      :class="{ 'is-precision': verticalPrecision }">
      <span
        class="word-ruler-margin-shade is-start"
        :style="{ height: percentage(margins.marginTop, PAGE_HEIGHT_MM) }"
      />
      <span
        class="word-ruler-margin-shade is-end"
        :style="{ height: percentage(margins.marginBottom, PAGE_HEIGHT_MM) }"
      />

      <span class="word-vertical-ruler-page-ticks">
        <span
          v-for="tick in verticalPageTicks"
          :key="tick"
          class="word-ruler-tick"
          :class="{
            'is-major': tick % 5 === 0,
            'is-boundary': isVerticalBoundaryTick(tick),
          }"
          :style="{
            top: `calc(${percentage(margins.marginTop, PAGE_HEIGHT_MM)} + ${percentage(tick, PAGE_HEIGHT_MM)})`,
          }"
        />
      </span>

      <span
        class="word-vertical-ruler-scale"
        :style="{
          top: percentage(margins.marginTop, PAGE_HEIGHT_MM),
          bottom: percentage(margins.marginBottom, PAGE_HEIGHT_MM),
        }"
      >
        <span
          v-for="tick in verticalTicks"
          :key="tick"
          class="word-ruler-tick"
          :class="{
            'is-major': tick % 5 === 0,
            'has-label': tick > 0 && tick % 10 === 0,
            'is-boundary': isVerticalBoundaryTick(tick),
          }"
          :style="{ top: verticalContentPercentage(tick) }"
        >
          <span
            v-if="tick > 0 && tick % 10 === 0 && !isVerticalBoundaryTick(tick)"
            class="word-ruler-label"
          >{{ tick / 10 }}</span>
        </span>
      </span>

      <button
        type="button"
        class="word-ruler-boundary is-vertical is-start"
        :style="{ top: percentage(margins.marginTop, PAGE_HEIGHT_MM) }"
        :aria-label="`调整第 ${currentPageNumber} 页上边距`"
        title="拖动调整上边距"
        @pointerdown="startMarginDrag('marginTop', $event)"
      />
      <button
        type="button"
        class="word-ruler-boundary is-vertical is-end"
        :style="{
          top: percentage(PAGE_HEIGHT_MM - margins.marginBottom, PAGE_HEIGHT_MM),
        }"
        :aria-label="`调整第 ${currentPageNumber} 页下边距`"
        title="拖动调整下边距"
        @pointerdown="startMarginDrag('marginBottom', $event)"
      />
      <span
        v-if="marginGuide && !marginGuide.horizontal"
        class="word-margin-guide is-across"
        :style="{ top: marginGuidePosition, width: `${marginGuide.length}px` }"
        aria-hidden="true"
      />
      <template v-if="verticalPrecision">
        <span v-for="segment in precisionSegments(false)" :key="segment.start"
          class="word-ruler-measure is-vertical"
          :style="{ top: segment.start, height: segment.size }">
          <span class="word-measure-arrow is-start" aria-hidden="true" />
          <span class="word-measure-label">{{ segment.label }}</span>
          <span class="word-measure-arrow is-end" aria-hidden="true" />
        </span>
      </template>
    </div>
  </div>
</template>

<style src="./WordRulers.css"></style>
