<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

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
}>()

const emit = defineEmits<{
  marginChange: [key: MarginKey, value: number]
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

const stopMarginDrag = () => {
  removeMarginDragListeners?.()
  removeMarginDragListeners = null
}

const startMarginDrag = (key: MarginKey, event: PointerEvent) => {
  event.preventDefault()
  stopMarginDrag()

  const horizontal = key === 'marginLeft' || key === 'marginRight'
  const ruler = horizontal ? horizontalRuler.value : verticalRuler.value
  if (!ruler) return

  const move = (pointerEvent: PointerEvent) => {
    const rect = ruler.getBoundingClientRect()
    const pageSize = horizontal ? PAGE_WIDTH_MM : PAGE_HEIGHT_MM
    const pointerPosition = horizontal
      ? pointerEvent.clientX - rect.left
      : pointerEvent.clientY - rect.top
    const rulerSize = horizontal ? rect.width : rect.height
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
    const clampedMargin = Math.max(0, Math.min(maximumMargin, rawMargin))
    const steppedMargin = Math.round(clampedMargin / step) * step

    emit('marginChange', key, steppedMargin)
  }

  const end = (pointerEvent: PointerEvent) => {
    move(pointerEvent)
    stopMarginDrag()
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', stopMarginDrag)
  removeMarginDragListeners = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', stopMarginDrag)
  }

  move(event)
}

onBeforeUnmount(stopMarginDrag)
</script>

<template>
  <div class="word-horizontal-ruler-shell">
    <span class="word-current-page-indicator">第 {{ currentPageNumber }} 页</span>
    <div ref="horizontalRuler" class="word-ruler word-horizontal-ruler">
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
    </div>
  </div>

  <div class="word-vertical-ruler-shell" :style="verticalRulerPosition">
    <div ref="verticalRuler" class="word-ruler word-vertical-ruler">
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
    </div>
  </div>
</template>

<style src="./WordRulers.css"></style>
