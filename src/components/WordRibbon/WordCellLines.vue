<script setup lang="ts">
import { ElButton, ElTooltip } from 'element-plus'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/tooltip/style/css'
import { computed } from 'vue'
import { cellLineImages, type CellLine, type CellLineState } from '../WordEditor/cellLines'

defineProps<{ state: CellLineState }>()
const showTableGridlines = defineModel<boolean>('showTableGridlines', { required: true })
const emit = defineEmits<{ line: [line: CellLine | null] }>()

const options = [
  { line: 'lower', label: '下划线' },
  { line: 'upper', label: '上实线' },
  { line: 'dashed', label: '虚线' },
  { line: 'dashSolid', label: '虚实线' },
  { line: 'diagonal', label: '斜线' },
  { line: 'double', label: '双实线' },
  { line: null, label: '删除线' },
] as const
const gridlinesLabel = computed(() => showTableGridlines.value ? '隐藏网格线' : '显示网格线')
</script>

<template>
  <div class="word-cell-lines">
    <ElTooltip
      v-for="{ line, label } in options"
      :key="label"
      :content="label"
      placement="top"
      popper-class="word-cell-line-tooltip"
      :show-after="200"
      :enterable="false"
    >
      <span class="word-cell-line-control">
        <ElButton
          text
          size="small"
          class="word-cell-line-button"
          :aria-label="label"
          :aria-pressed="line ? state.line === line : undefined"
          :disabled="line ? !state.available : !state.canRemove"
          @mousedown.prevent
          @click="emit('line', line)"
        >
          <span
            class="word-cell-line-icon"
            :class="!line ? 'word-cell-line-remove-icon has-remove-mark' : undefined"
            :style="line ? { backgroundImage: cellLineImages[line] } : undefined"
            aria-hidden="true"
          />
        </ElButton>
      </span>
    </ElTooltip>
    <ElTooltip
      :content="gridlinesLabel"
      placement="top"
      popper-class="word-cell-line-tooltip"
      :show-after="200"
      :enterable="false"
    >
      <span class="word-cell-line-control">
        <ElButton
          text
          size="small"
          class="word-cell-line-button word-table-gridline-toggle"
          :aria-label="gridlinesLabel"
          :aria-pressed="showTableGridlines"
          @mousedown.prevent
          @click="showTableGridlines = !showTableGridlines"
        >
          <span
            class="word-cell-line-icon word-gridline-icon"
            :class="{ 'has-remove-mark': showTableGridlines }"
            aria-hidden="true"
          />
        </ElButton>
      </span>
    </ElTooltip>
  </div>
</template>

<style scoped>
:global(.word-cell-line-tooltip) {
  pointer-events: none;
}

.word-cell-lines {
  display: grid;
  grid-template-columns: repeat(4, 28px);
  gap: 4px 2px;
}

.word-cell-line-control {
  display: flex;
}

.word-cell-line-button.el-button {
  width: 100%;
  margin: 0;
  padding: 0;
}

.word-cell-line-button[aria-pressed="true"]:not(.word-table-gridline-toggle) {
  background: #e9f1fd;
  color: #185abd;
}

.word-cell-line-icon {
  position: relative;
  width: 16px;
  height: 13px;
  flex: none;
  border: 1px solid #a8b2c0;
  border-radius: 2px;
  background-size: 100% 100%;
  background-repeat: no-repeat;
}

.word-cell-line-remove-icon {
  background: linear-gradient(#273142 0 0) center / 80% 1px no-repeat;
}

.word-gridline-icon {
  border-style: dashed;
  color: #7c8490;
  background:
    repeating-linear-gradient(to right, currentColor 0 2px, transparent 2px 4px) center / 100% 1px no-repeat,
    repeating-linear-gradient(to bottom, currentColor 0 2px, transparent 2px 4px) center / 1px 100% no-repeat;
}

.has-remove-mark::before,
.has-remove-mark::after {
  position: absolute;
  right: -2px;
  bottom: 1px;
  width: 7px;
  height: 1.5px;
  border-radius: 1px;
  background: #d9363e;
  transform: rotate(45deg);
  content: "";
}

.has-remove-mark::after {
  transform: rotate(-45deg);
}
</style>
