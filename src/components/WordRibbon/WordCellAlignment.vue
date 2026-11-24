<script setup lang="ts">
import { ElButton } from 'element-plus'
import 'element-plus/es/components/button/style/css'
import type { TableCellAlignment, TableCellAlignmentState } from '../WordEditor/documentTable'

defineProps<{ state: TableCellAlignmentState }>()
const emit = defineEmits<{ align: [alignment: TableCellAlignment] }>()

const rows = [
  { value: 'top', label: '靠上', position: 'start' },
  { value: 'middle', label: '中部', position: 'center' },
  { value: 'bottom', label: '靠下', position: 'end' },
] as const
const columns = [
  { value: 'left', label: '左对齐', position: 'start' },
  { value: 'center', label: '居中对齐', position: 'center' },
  { value: 'right', label: '右对齐', position: 'end' },
] as const
const options = rows.flatMap(row => columns.map(column => ({
  key: row.value + '-' + column.value,
  label: row.label + column.label,
  alignment: { verticalAlign: row.value, textAlign: column.value },
  style: { alignContent: row.position, justifyItems: column.position },
})))
</script>

<template>
  <div class="word-cell-alignment" role="group" aria-label="单元格对齐">
    <ElButton
      v-for="option in options"
      :key="option.key"
      text
      class="word-cell-alignment-button"
      :aria-label="option.label"
      :title="option.label"
      :aria-pressed="state.alignment?.textAlign === option.alignment.textAlign
        && state.alignment?.verticalAlign === option.alignment.verticalAlign"
      :disabled="!state.available"
      @mousedown.prevent
      @click="emit('align', option.alignment)"
    >
      <span class="word-cell-alignment-icon" :style="option.style" aria-hidden="true">
        <span v-for="line in 3" :key="line" />
      </span>
    </ElButton>
  </div>
</template>

<style scoped>
.word-cell-alignment {
  display: grid;
  grid-template-columns: repeat(3, 24px);
  gap: 2px;
}

.word-cell-alignment .el-button {
  width: 24px;
  height: 22px;
  margin: 0;
  padding: 0;
}

.word-cell-alignment .el-button[aria-pressed="true"] {
  background: #e9f1fd;
  color: #185abd;
}

.word-cell-alignment-icon {
  display: grid;
  width: 16px;
  height: 16px;
  gap: 1px;
  border: 1px solid currentColor;
  border-radius: 2px;
  padding: 1px;
}

.word-cell-alignment-icon > span {
  width: 8px;
  height: 1px;
  background: currentColor;
}

.word-cell-alignment-icon > span:nth-child(2) {
  width: 5px;
}
</style>
