<script setup lang="ts">
import { ElButton, ElPopover, ElRadioButton, ElRadioGroup } from 'element-plus'
import 'element-plus/es/components/radio-button/style/css'
import 'element-plus/es/components/radio-group/style/css'
import { ref } from 'vue'
import { tableBorderScopes, tableBorderStyles, type TableBorderChange, type TableBorders, type TableBorderStyle } from '../WordEditor/tableBorders'

type BorderScope = keyof typeof tableBorderScopes

const showTableGridlines = defineModel<boolean>('showTableGridlines', { required: true })
const props = defineProps<{ borders: TableBorders | null }>()
const emit = defineEmits<{ change: [change: TableBorderChange] }>()

const popover = ref<InstanceType<typeof ElPopover> | null>(null)
const lineStyle = ref<TableBorderStyle>('solid')
const styleLabels: Record<TableBorderStyle, string> = { solid: '实线', dashed: '虚线', double: '双实线' }
const scopeOptions = [
  { value: 'all', label: '所有边框' },
  { value: 'outside', label: '外边框' },
  { value: 'inside', label: '内边框' },
  { value: 'horizontal', label: '内部横线' },
  { value: 'vertical', label: '内部竖线' },
  { value: 'top', label: '上边框' },
  { value: 'bottom', label: '下边框' },
  { value: 'left', label: '左边框' },
  { value: 'right', label: '右边框' },
] as const satisfies ReadonlyArray<{ value: BorderScope; label: string }>

const isApplied = (scope: BorderScope) => {
  const current = props.borders
  return Boolean(current && tableBorderScopes[scope].every(edge => current.lines[edge] === lineStyle.value))
}

const apply = (change: TableBorderChange) => {
  popover.value?.hide()
  emit('change', change)
}
</script>

<template>
  <ElButton
    text
    class="word-page-setup-button word-table-gridline-toggle"
    :aria-pressed="showTableGridlines"
    title="显示或隐藏整篇文档的表格网格线"
    @mousedown.prevent
    @click="showTableGridlines = !showTableGridlines"
  >
    <span
      class="word-border-grid word-gridline-icon"
      :class="{ 'has-remove-mark': showTableGridlines }"
      aria-hidden="true"
    />
    <span>{{ showTableGridlines ? '隐藏网格线' : '显示网格线' }}</span>
  </ElButton>
  <ElPopover
    ref="popover"
    trigger="click"
    placement="bottom-start"
    aria-label="表格边框"
    popper-class="word-border-popover"
    :width="286"
    :offset="4"
    :show-arrow="false"
    :disabled="borders === null"
  >
    <template #reference>
      <ElButton text class="word-page-setup-button word-table-border-button" :disabled="borders === null">
        <span class="word-border-grid" aria-hidden="true" />
        <span class="word-page-setup-label">
          表格边框
          <span class="word-style-chevron" aria-hidden="true" />
        </span>
      </ElButton>
    </template>
    <div class="word-border-label">线型</div>
    <ElRadioGroup v-model="lineStyle" size="small" aria-label="边框线型">
      <ElRadioButton v-for="style in tableBorderStyles" :key="style" :value="style">
        <span class="word-border-sample" :class="`is-${style}`" aria-hidden="true" />
        {{ styleLabels[style] }}
      </ElRadioButton>
    </ElRadioGroup>
    <div class="word-border-label word-border-scope-label">应用范围</div>
    <div class="word-border-options">
      <ElButton
        v-for="scope in scopeOptions"
        :key="scope.value"
        size="small"
        :type="isApplied(scope.value) ? 'primary' : 'default'"
        :aria-pressed="isApplied(scope.value)"
        :data-border-scope="scope.value"
        @click="apply({ scope: scope.value, style: lineStyle })"
      >{{ scope.label }}</ElButton>
      <ElButton size="small" data-border-scope="none" @click="apply('none')">无边框</ElButton>
    </div>
  </ElPopover>
</template>

<style scoped>
.word-border-grid {
  width: 34px;
  height: 28px;
  flex: none;
  border: 2px solid currentColor;
  border-radius: 3px;
  color: #394150;
  background:
    linear-gradient(currentColor 0 0) center / 1px 100% no-repeat,
    linear-gradient(currentColor 0 0) center / 100% 1px no-repeat;
}

.word-gridline-icon {
  position: relative;
  border-style: dashed;
  color: #7c8490;
  background:
    repeating-linear-gradient(to right, currentColor 0 3px, transparent 3px 5px) center / 100% 1px no-repeat,
    repeating-linear-gradient(to bottom, currentColor 0 3px, transparent 3px 5px) center / 1px 100% no-repeat;
}

.word-gridline-icon.has-remove-mark::before,
.word-gridline-icon.has-remove-mark::after {
  position: absolute;
  right: -3.5px;
  bottom: 0;
  width: 9px;
  height: 2px;
  border-radius: 1px;
  background: #d9363e;
  transform: rotate(45deg);
  content: "";
}

.word-gridline-icon.has-remove-mark::after {
  transform: rotate(-45deg);
}

.word-table-border-button .word-border-grid {
  border-color: #485f7a;
  background-color: #eef2f8;
}

.word-border-label {
  margin-bottom: 6px;
  color: #394150;
  font-size: 12px;
  font-weight: 600;
}

.word-border-scope-label {
  margin-top: 12px;
}

.word-border-sample {
  display: inline-block;
  width: 16px;
  margin-right: 3px;
  border-top: 1px solid currentColor;
  vertical-align: middle;
}

.word-border-sample.is-dashed {
  border-top-style: dashed;
}

.word-border-sample.is-double {
  border-top: 3px double currentColor;
}

.word-border-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
}

.word-border-options > .el-button {
  margin-left: 0;
  padding-inline: 3px;
}
</style>
