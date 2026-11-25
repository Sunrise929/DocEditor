<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowReactive, shallowRef } from 'vue'
import { MIN_CONTENT_HEIGHT_MM, MIN_CONTENT_WIDTH_MM, type PageMargins } from '../WordEditor/pageGeometry'
import { resizeAdjacentColumns, type TableRulerContext } from '../WordEditor/tableRuler'
import { adjustCellIndent, adjustIndent, type IndentHandle, type ParagraphIndent } from './paragraphIndent'

defineOptions({ name: 'WordRulers' })

type MarginKey = keyof PageMargins

const props = defineProps<{
  currentPageNumber: number
  pageWidth: number
  pageHeight: number
  pageOffset: number
  margins: PageMargins
  paragraphIndent: ParagraphIndent | null
  paragraphNumberGap?: number
  tableRuler: TableRulerContext | null
  columnResizePreview: { index: number; offset: number } | null
}>()

const emit = defineEmits<{
  marginChange: [key: MarginKey, value: number]
  indentChange: [handle: IndentHandle, delta: number]
  columnResize: [table: TableRulerContext['table'], widths: number[]]
  tableIndentChange: [table: TableRulerContext['table'], indent: number]
}>()

const rulerTicks = (length: number, includeNegative = false) => {
  const count = Math.floor(length / 2.5)
  const start = includeNegative ? -count : 0
  return Array.from({ length: count - start + 1 }, (_, index) => (start + index) * 2.5)
}
const horizontalTicks = computed(() => rulerTicks(props.pageWidth))
const horizontalPageTicks = computed(() => rulerTicks(props.pageWidth, true))
const verticalTicks = computed(() => rulerTicks(props.pageHeight))
const verticalPageTicks = computed(() => rulerTicks(props.pageHeight, true))

const horizontalRuler = ref<HTMLElement | null>(null)
const verticalRuler = ref<HTMLElement | null>(null)

const indentHandles = [
  { key: 'first', label: '首行缩进' },
  { key: 'hanging', label: '悬挂缩进' },
  { key: 'left', label: '左缩进' },
  { key: 'right', label: '右缩进' },
] as const
const indentBounds = computed(() => {
  const cell = tableGeometry.value?.cell
  return cell ? { start: tableIndentPreview(cell.start), end: tableIndentPreview(cell.end) }
    : { start: props.margins.marginLeft, end: props.pageWidth - props.margins.marginRight }
})
const indentWidth = computed(() => (indentBounds.value.end - indentBounds.value.start) / 10)
const indentDrag = ref<{ handle: IndentHandle; pointerId: number; startX: number; delta: number; precise: boolean; handleBottomOffset: number } | null>(null)
const indentGuideHeight = ref(0)
let replayDrag: ((precise: boolean) => void) | undefined

const changePrecision = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && tableDrag.value) {
    event.preventDefault()
    stopTableDrag()
    return
  }
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
  if (!indent) return null
  const gap = props.paragraphNumberGap
  if (!drag) return gap === undefined ? indent : { ...indent, firstLineOffset: Math.min(indent.firstLineOffset, -gap) }
  if (props.tableRuler?.cell) return adjustCellIndent(indent, drag.handle, drag.delta, indentWidth.value, gap)
  return adjustIndent(
    indent, drag.handle, drag.delta, indentWidth.value,
    props.margins.marginLeft / 10, props.margins.marginRight / 10, gap,
  )
})

const indentCoordinate = (handle: IndentHandle) => {
  const indent = shownIndent.value
  if (!indent) return 0
  const offset = handle === 'right' ? indentWidth.value - indent.indentRight
    : indent.indentLeft + (handle === 'first' ? indent.firstLineOffset : 0)
  return indentBounds.value.start + offset * 10
}

const indentPosition = (handle: IndentHandle) =>
  percentage(indentCoordinate(handle), props.pageWidth)

const startIndentDrag = (handle: IndentHandle, event: PointerEvent) => {
  const ruler = horizontalRuler.value
  if (event.button !== 0 || indentDrag.value || tableDrag.value || marginGuide.value || !ruler) return
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
  const delta = direction * (event.clientX - drag.startX) / rect.width * (props.pageWidth / 10)
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

type TableDrag = {
  context: TableRulerContext
  index: number
  pointerId: number
  startX: number
  widths: number[]
  indentLeft: number
  guideHeight: number
  precise: boolean
}
const tableDrag = shallowRef<TableDrag | null>(null)
const tableGeometry = computed(() => tableDrag.value?.context ?? props.tableRuler)

const tableIndentLimit = computed(() => {
  const contentWidth = props.pageWidth - props.margins.marginLeft - props.margins.marginRight
  return Math.max(0, Math.floor((contentWidth - MIN_CONTENT_WIDTH_MM) * 10 + 1e-9) / 100)
})

const adjustedTableIndent = (context: TableRulerContext, deltaCm: number, precise: boolean) => {
  const step = precise ? 0.01 : 0.25
  const adjustment = Math.round(deltaCm / step) * step
  if (!adjustment) return context.indentLeft
  const next = Number((context.indentLeft + adjustment).toFixed(2))
  const maxIndent = Math.max(context.indentLeft, tableIndentLimit.value)
  return Math.max(0, Math.min(maxIndent, next))
}

const tableIndentPreview = (coordinate: number) => {
  const drag = tableDrag.value
  if (drag?.index !== 0) return coordinate
  const { edges, indentLeft } = drag.context
  const right = edges.at(-1)!
  const width = right - edges[0]!
  return width > 0 ? coordinate + (right - coordinate) / width * (drag.indentLeft - indentLeft) * 10 : coordinate
}

const tableEdge = (index: number) => {
  const context = tableGeometry.value!
  const drag = tableDrag.value
  const edge = context.edges[index]!
  if (drag?.index === 0) return tableIndentPreview(edge)
  if (drag?.index === index) {
    const change = drag.widths[index - 1]! - context.widths[index - 1]!
    return edge + change / context.pixelsPerMm
  }
  const preview = props.columnResizePreview
  return preview?.index === index ? edge + preview.offset / context.pixelsPerMm : edge
}

const tableGuideIndex = computed(() => tableDrag.value?.index ?? props.columnResizePreview?.index)
const tableGuideHeight = computed(() => {
  if (tableDrag.value) return tableDrag.value.guideHeight
  if (tableGuideIndex.value === undefined || !horizontalRuler.value) return 0
  return Math.max(0, document.documentElement.clientHeight - horizontalRuler.value.getBoundingClientRect().bottom)
})

const columnHandles = computed(() => (tableGeometry.value?.visibleEdges ?? []).flatMap(index => {
  const edge = tableEdge(index)
  return edge >= 0 && edge <= props.pageWidth ? [{ index, edge }] : []
}))

const tableIndentHandle = computed(() => {
  const context = tableGeometry.value
  if (!context) return null
  const edge = tableEdge(0)
  return edge >= 0 && edge <= props.pageWidth ? edge : null
})

const startTableDrag = (index: number, event: PointerEvent) => {
  const context = props.tableRuler
  const ruler = horizontalRuler.value
  if (event.button !== 0 || !context || !ruler || tableDrag.value || indentDrag.value || marginGuide.value) return
  event.preventDefault()
  ruler.setPointerCapture(event.pointerId)
  tableDrag.value = shallowReactive({
    context, index, pointerId: event.pointerId, startX: event.clientX,
    widths: context.widths,
    indentLeft: context.indentLeft,
    guideHeight: Math.max(0, document.documentElement.clientHeight - ruler.getBoundingClientRect().bottom),
    precise: event.altKey,
  })
  listenForPrecision()
  window.addEventListener('blur', stopTableDrag)
  moveTableDrag(event)
}

const moveTableDrag = (event: PointerEvent, precise = event.altKey) => {
  const drag = tableDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  replayDrag = next => moveTableDrag(event, next)
  drag.precise = precise
  const distance = event.clientX - drag.startX
  if (drag.index === 0) {
    drag.indentLeft = adjustedTableIndent(drag.context, distance / (drag.context.pixelsPerMm * 10), precise)
  } else {
    const step = precise ? 1 : drag.context.pixelsPerMm * 2.5
    drag.widths = resizeAdjacentColumns(drag.context.widths, drag.index, Math.round(distance / step) * step)
  }
}

const commitColumns = (context: TableRulerContext, widths: number[]) => {
  if (widths.some((width, index) => width !== context.widths[index])) emit('columnResize', context.table, widths)
}

const stopTableDrag = () => {
  tableDrag.value = null
  stopPrecision()
  window.removeEventListener('blur', stopTableDrag)
}

const moveHorizontalDrag = (event: PointerEvent) => {
  if (tableDrag.value) moveTableDrag(event)
  else moveIndentDrag(event)
}

const finishHorizontalDrag = (event: PointerEvent) => {
  const drag = tableDrag.value
  if (!drag) return finishIndentDrag(event)
  if (drag.pointerId !== event.pointerId) return
  moveTableDrag(event)
  stopTableDrag()
  if (drag.index === 0) {
    if (drag.indentLeft !== drag.context.indentLeft) emit('tableIndentChange', drag.context.table, drag.indentLeft)
  } else {
    commitColumns(drag.context, drag.widths)
  }
}

const cancelHorizontalDrag = (event: PointerEvent) => {
  if (tableDrag.value?.pointerId === event.pointerId) stopTableDrag()
  else cancelIndentDrag(event)
}

const moveTableHandleWithKey = (index: number, direction: number, event: KeyboardEvent) => {
  const context = props.tableRuler
  if (!context || tableDrag.value || indentDrag.value || marginGuide.value) return
  if (index === 0) {
    const step = event.altKey ? 0.01 : 0.25
    const indent = adjustedTableIndent(context, direction * step, event.altKey)
    if (indent !== context.indentLeft) emit('tableIndentChange', context.table, indent)
  } else {
    const step = event.altKey ? 1 : context.pixelsPerMm * 2.5
    commitColumns(context, resizeAdjacentColumns(context.widths, index, direction * step))
  }
}

const verticalRulerPosition = computed(() => ({
  top: `calc(var(--horizontal-ruler-height) + var(--document-padding-block) + ${props.pageOffset}px)`,
}))

const percentage = (value: number, total: number) =>
  `${(value / total) * 100}%`

const isHorizontalBoundaryTick = (tick: number) => {
  const contentWidth =
    props.pageWidth - props.margins.marginLeft - props.margins.marginRight

  return Math.abs(tick) < 0.001 || Math.abs(tick - contentWidth) < 0.001
}

const isVerticalBoundaryTick = (tick: number) => {
  const contentHeight =
    props.pageHeight - props.margins.marginTop - props.margins.marginBottom

  return Math.abs(tick) < 0.001 || Math.abs(tick - contentHeight) < 0.001
}

const verticalContentPercentage = (tick: number) => {
  const contentHeight =
    props.pageHeight - props.margins.marginTop - props.margins.marginBottom

  return percentage(tick, contentHeight)
}

let removeMarginDragListeners: (() => void) | null = null
const marginGuide = ref<{ key: MarginKey; horizontal: boolean; length: number; precise: boolean } | null>(null)
const horizontalPrecision = computed(() =>
  Boolean(tableDrag.value?.precise || indentDrag.value?.precise || (marginGuide.value?.precise && marginGuide.value.horizontal)),
)
const verticalPrecision = computed(() => Boolean(marginGuide.value?.precise && !marginGuide.value.horizontal))

const precisionSegments = (horizontal: boolean) => {
  const total = horizontal ? props.pageWidth : props.pageHeight
  const { marginLeft, marginRight, marginTop, marginBottom } = props.margins
  const start = horizontal ? marginLeft : marginTop
  const end = total - (horizontal ? marginRight : marginBottom)
  const marks = horizontal && tableDrag.value
    ? [
        ...(tableDrag.value.index === 0 ? [start] : []),
        tableEdge(0),
        ...columnHandles.value.map(handle => handle.edge),
        tableEdge(tableDrag.value.widths.length),
      ]
    : [0, total, start, end]
  if (horizontal && !tableDrag.value && shownIndent.value) {
    marks.push(indentBounds.value.start, indentBounds.value.end)
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
  const total = guide.horizontal ? props.pageWidth : props.pageHeight
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
  if (event.button !== 0 || indentDrag.value || tableDrag.value) return
  event.preventDefault()
  stopMarginDrag()

  const horizontal = key === 'marginLeft' || key === 'marginRight'
  const ruler = horizontal ? horizontalRuler.value : verticalRuler.value
  if (!ruler) return

  const rulerRect = ruler.getBoundingClientRect()
  const leftMarginGrabOffset = key === 'marginLeft' && tableIndentHandle.value !== null
    ? event.clientX - rulerRect.left - rulerRect.width * props.margins.marginLeft / props.pageWidth
    : 0

  const move = (pointerEvent: PointerEvent, precise = pointerEvent.altKey) => {
    if (pointerEvent.pointerId !== event.pointerId) return
    const rect = ruler.getBoundingClientRect()
    const pageSize = horizontal ? props.pageWidth : props.pageHeight
    const pointerPosition = horizontal
      ? pointerEvent.clientX - rect.left - leftMarginGrabOffset
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
  stopTableDrag()
})
</script>

<template>
  <div class="word-horizontal-ruler-shell">
    <span class="word-current-page-indicator">第 {{ currentPageNumber }} 页</span>
    <div
      ref="horizontalRuler"
      class="word-ruler word-horizontal-ruler"
      :class="{ 'is-precision': horizontalPrecision }"
      @pointermove="moveHorizontalDrag"
      @pointerup="finishHorizontalDrag"
      @pointercancel="cancelHorizontalDrag"
      @lostpointercapture="cancelHorizontalDrag"
    >
      <span
        class="word-ruler-margin-shade is-start"
        :style="{ width: percentage(margins.marginLeft, pageWidth) }"
      />
      <span
        class="word-ruler-margin-shade is-end"
        :style="{ width: percentage(margins.marginRight, pageWidth) }"
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
            left: `calc(${percentage(margins.marginLeft, pageWidth)} + ${tick}mm)`,
          }"
        />
      </span>

      <span
        class="word-horizontal-ruler-scale"
        :style="{
          left: percentage(margins.marginLeft, pageWidth),
          right: percentage(margins.marginRight, pageWidth),
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
        :class="{ 'has-table-indent': tableIndentHandle !== null }"
        :style="{ left: percentage(margins.marginLeft, pageWidth) }"
        :aria-label="`调整第 ${currentPageNumber} 页左边距`"
        title="拖动调整左边距"
        @pointerdown="startMarginDrag('marginLeft', $event)"
      />
      <button
        type="button"
        class="word-ruler-boundary is-horizontal is-end"
        :style="{
          left: percentage(pageWidth - margins.marginRight, pageWidth),
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
      <button
        v-if="tableIndentHandle !== null"
        type="button"
        class="word-table-indent-handle"
        :style="{ left: percentage(tableIndentHandle, pageWidth) }"
        aria-label="调整表格左缩进"
        :title="`表格左缩进 ${tableDrag?.indentLeft ?? tableRuler?.indentLeft} cm，Alt 精细调整`"
        @pointerdown="startTableDrag(0, $event)"
        @keydown.left.prevent="moveTableHandleWithKey(0, -1, $event)"
        @keydown.right.prevent="moveTableHandleWithKey(0, 1, $event)"
      />
      <button
        v-for="{ index, edge } in columnHandles"
        :key="index"
        type="button"
        class="word-table-column-handle"
        :style="{ left: percentage(edge, pageWidth) }"
        :aria-label="`调整第 ${index} 列列宽`"
        title="拖动调整相邻列宽，Alt 精细调整"
        @pointerdown="startTableDrag(index, $event)"
        @keydown.left.prevent="moveTableHandleWithKey(index, -1, $event)"
        @keydown.right.prevent="moveTableHandleWithKey(index, 1, $event)"
      />
      <span
        v-if="tableGuideIndex !== undefined"
        class="word-margin-guide is-down word-table-column-guide"
        :style="{
          left: percentage(tableEdge(tableGuideIndex), pageWidth),
          height: `${tableGuideHeight}px`,
        }"
        aria-hidden="true"
      />
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
        :style="{ height: percentage(margins.marginTop, pageHeight) }"
      />
      <span
        class="word-ruler-margin-shade is-end"
        :style="{ height: percentage(margins.marginBottom, pageHeight) }"
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
            top: `calc(${percentage(margins.marginTop, pageHeight)} + ${percentage(tick, pageHeight)})`,
          }"
        />
      </span>

      <span
        class="word-vertical-ruler-scale"
        :style="{
          top: percentage(margins.marginTop, pageHeight),
          bottom: percentage(margins.marginBottom, pageHeight),
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
        :style="{ top: percentage(margins.marginTop, pageHeight) }"
        :aria-label="`调整第 ${currentPageNumber} 页上边距`"
        title="拖动调整上边距"
        @pointerdown="startMarginDrag('marginTop', $event)"
      />
      <button
        type="button"
        class="word-ruler-boundary is-vertical is-end"
        :style="{
          top: percentage(pageHeight - margins.marginBottom, pageHeight),
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
