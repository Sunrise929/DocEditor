<script setup lang="ts">
import { ElAlert, ElButton, ElColorPicker, ElDialog } from 'element-plus'
import 'element-plus/es/components/alert/style/css'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/color-picker/style/css'
import 'element-plus/es/components/dialog/style/css'
import { computed, ref, shallowRef } from 'vue'
import TableBorderDiagram from './TableBorderDiagram.vue'
import {
  defaultTableBorders, tableBorderLineCss, tableBorderScopes,
  type TableBorderEdge, type TableBorderLine, type TableBorders,
} from './tableBorders'

const props = defineProps<{ apply: (borders: TableBorders) => boolean }>()
const emit = defineEmits<{ closed: [] }>()

const defaultColor = '#000000'
const colors = ['#000000', '#6b7280', '#185abd', '#16784d', '#b42318', '#dc7800', '#7f438f', '#ffffff']
const lineOptions = [
  { label: '无', style: null, width: 0 },
  { label: '点线', style: 'dotted', width: 1 },
  { label: '虚线', style: 'dashed', width: 1 },
  { label: '细实线', style: 'solid', width: 1 },
  { label: '中实线', style: 'solid', width: 2 },
  { label: '粗实线', style: 'solid', width: 3 },
  { label: '特粗实线', style: 'solid', width: 4 },
  { label: '双实线', style: 'double', width: 3 },
] as const
const presets = [
  { key: 'none', label: '无', edges: [] },
  { key: 'outside', label: '外边框', edges: tableBorderScopes.outside },
  { key: 'inside', label: '内边框', edges: tableBorderScopes.inside },
] as const
const edgeGroups = [
  {
    axis: 'horizontal',
    edges: [
      { key: 'top', label: '上边框' },
      { key: 'horizontal', label: '横向内边框' },
      { key: 'bottom', label: '底边框' },
    ],
  },
  {
    axis: 'vertical',
    edges: [
      { key: 'left', label: '左边框' },
      { key: 'vertical', label: '竖向内边框' },
      { key: 'right', label: '右边框' },
    ],
  },
] as const

const visible = ref(false)
const draft = shallowRef<TableBorders>(defaultTableBorders)
const selectedLine = shallowRef<typeof lineOptions[number]>(lineOptions[3])
const color = ref<string | null>(defaultColor)
const error = ref(false)
const hasBorders = computed(() => Object.keys(draft.value.lines).length > 0)

const show = (borders: TableBorders) => {
  draft.value = borders
  const line = Object.values(borders.lines)[0]
  selectedLine.value = lineOptions.find(option => option.style === line?.style && option.width === line.width)
    ?? lineOptions[3]
  color.value = line?.color ?? defaultColor
  error.value = false
  visible.value = true
}

const selectedStroke = computed<TableBorderLine | null>(() => {
  const { style, width } = selectedLine.value
  return style ? { style, width, color: color.value ?? defaultColor } : null
})

const applyEdges = (edges: readonly TableBorderEdge[], line = selectedStroke.value) => {
  const lines = { ...draft.value.lines }
  for (const edge of edges) {
    if (line) lines[edge] = line
    else delete lines[edge]
  }
  draft.value = { lines }
}

const toggleEdge = (edge: TableBorderEdge) => {
  applyEdges([edge], draft.value.lines[edge] ? null : selectedStroke.value)
}

const applyPreset = (preset: typeof presets[number]) => {
  if (preset.key === 'none') draft.value = defaultTableBorders
  else applyEdges(preset.edges)
}

const confirm = () => {
  if (props.apply(draft.value)) visible.value = false
  else error.value = true
}

defineExpose({ show })
</script>

<template>
  <ElDialog
    v-model="visible"
    class="word-table-borders-dialog"
    title="表格边框"
    width="min(560px, calc(100vw - 32px))"
    align-center
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
    @closed="emit('closed')"
  >
    <div class="word-border-settings">
      <section class="word-border-stroke-settings" aria-label="线种和颜色">
        <h3>线种</h3>
        <div class="word-border-line-options" role="group" aria-label="边框线种">
          <ElButton
            v-for="option in lineOptions"
            :key="option.label"
            text
            class="word-border-line-option"
            :class="{ 'is-none': !option.style }"
            :title="option.label"
            :aria-label="option.label"
            :aria-pressed="option === selectedLine"
            @click="selectedLine = option"
          >
            <span
              v-if="option.style"
              class="word-border-line-sample"
              :style="{ borderTop: tableBorderLineCss({ ...option, style: option.style, color: color ?? defaultColor }) }"
            />
            <template v-else>无</template>
          </ElButton>
        </div>
        <div class="word-border-color">
          <span>颜色</span>
          <ElColorPicker v-model="color" color-format="hex" aria-label="边框颜色" :predefine="colors" />
        </div>
      </section>

      <div class="word-border-placement">
        <section aria-label="预置">
          <h3>预置</h3>
          <div class="word-border-presets">
            <ElButton
              v-for="preset in presets"
              :key="preset.key"
              text
              class="word-border-preset"
              :data-border-preset="preset.key"
              :class="{ 'is-current': preset.key === 'none' ? !hasBorders : preset.edges.every(edge => draft.lines[edge]) }"
              @click="applyPreset(preset)"
            >
              <TableBorderDiagram :highlight="preset.edges" />
              <span>{{ preset.label }}</span>
            </ElButton>
          </div>
        </section>

        <section aria-label="边框">
          <h3>边框</h3>
          <div class="word-border-preview-controls">
            <div class="word-border-preview" role="img" aria-label="表格边框预览">
              <TableBorderDiagram :lines="draft.lines" />
            </div>
            <div
              v-for="group in edgeGroups"
              :key="group.axis"
              class="word-border-edge-group"
              :class="'is-' + group.axis"
            >
              <ElButton
                v-for="edge in group.edges"
                :key="edge.key"
                text
                class="word-border-edge"
                :aria-label="edge.label"
                :title="edge.label"
                :aria-pressed="Boolean(draft.lines[edge.key])"
                :data-border-edge="edge.key"
                @click="toggleEdge(edge.key)"
              >
                <TableBorderDiagram :highlight="[edge.key]" />
              </ElButton>
            </div>
          </div>
        </section>
      </div>
    </div>
    <ElAlert v-if="error" class="word-border-error" title="表格已有变化，请关闭弹框后重新打开。" type="warning" :closable="false" />
    <template #footer>
      <ElButton @click="visible = false">取消</ElButton>
      <ElButton type="primary" @click="confirm">确认</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.word-border-settings {
  display: grid;
  grid-template-columns: minmax(128px, 0.8fr) minmax(0, 1.4fr);
  gap: 18px;
  max-height: 64dvh;
  overflow: auto;
}

.word-border-settings h3 {
  margin: 0 0 8px;
  color: #273142;
  font-weight: 600;
}

.word-border-stroke-settings {
  border-right: 1px solid #e2e7ee;
  padding-right: 16px;
}

.word-border-line-options,
.word-border-presets,
.word-border-edge-group {
  display: grid;
  gap: 4px;
}

.word-border-line-options {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.word-border-settings .el-button {
  margin: 0;
}

.word-border-line-option.el-button {
  height: 30px;
  padding-inline: 8px;
}

.word-border-line-option.is-none {
  grid-column: 1 / -1;
}

.word-border-line-sample {
  display: block;
  width: 38px;
  max-width: 100%;
}

.word-border-color {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
}

.word-border-placement {
  display: grid;
  gap: 16px;
}

.word-border-presets {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.word-border-preset.el-button {
  height: 54px;
  padding: 4px;
}

.word-border-preset :deep(> span) {
  display: grid;
  justify-items: center;
  gap: 4px;
}

.word-border-preview-controls {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas: 'horizontal preview' '. vertical';
  gap: 4px 10px;
}

.word-border-preview {
  display: grid;
  grid-area: preview;
  align-items: center;
  min-width: 0;
}

.word-border-preview :deep(.word-border-diagram) {
  width: 100%;
  height: auto;
  aspect-ratio: 1.618 / 1;
}

.word-border-edge-group.is-horizontal {
  display: flex;
  grid-area: horizontal;
  flex-direction: column;
  justify-content: space-between;
}

.word-border-edge-group.is-vertical {
  grid-area: vertical;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.word-border-edge.el-button {
  height: 30px;
  padding-inline: 5px;
}

.word-border-settings .el-button[aria-pressed="true"],
.word-border-preset.is-current {
  background: #e7effb;
  color: #185abd;
}

.word-border-error {
  margin-top: 10px;
}

@media (max-width: 460px) {
  .word-border-settings {
    grid-template-columns: 1fr;
  }

  .word-border-stroke-settings {
    border-right: 0;
    border-bottom: 1px solid #e2e7ee;
    padding: 0 0 12px;
  }
}
</style>
