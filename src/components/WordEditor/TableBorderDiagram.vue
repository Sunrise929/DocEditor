<script setup lang="ts">
import { tableBorderEdges, tableBorderLineCss, type TableBorderEdge, type TableBorders } from './tableBorders'

const props = defineProps<{
  lines?: TableBorders['lines']
  highlight?: readonly TableBorderEdge[]
}>()

const stroke = (edge: TableBorderEdge) => {
  const line = props.lines?.[edge]
  if (line) return tableBorderLineCss(line)
  return props.highlight?.includes(edge) ? '2px solid #3e5676' : '1px dashed #a8b2c0'
}
</script>

<template>
  <span class="word-border-diagram" aria-hidden="true">
    <span
      v-for="edge in tableBorderEdges"
      :key="edge"
      class="word-border-diagram-line"
      :class="'is-' + edge"
      :style="{ '--stroke': stroke(edge) }"
    />
  </span>
</template>

<style scoped>
.word-border-diagram {
  position: relative;
  display: block;
  width: 24px;
  height: 20px;
  flex: none;
}

.word-border-diagram-line {
  position: absolute;
}

.is-top, .is-horizontal, .is-bottom {
  right: 0;
  left: 0;
  border-top: var(--stroke);
}

.is-left, .is-vertical, .is-right {
  top: 0;
  bottom: 0;
  border-left: var(--stroke);
}

.is-top { top: 0; }
.is-bottom { bottom: 0; }
.is-left { left: 0; }
.is-right { right: 0; }
.is-horizontal { top: 50%; transform: translateY(-50%); }
.is-vertical { left: 50%; transform: translateX(-50%); }
</style>
