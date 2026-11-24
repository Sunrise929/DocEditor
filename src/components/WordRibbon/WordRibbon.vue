<script setup lang="ts">
import { ElButton, ElCheckbox, ElDropdown, ElDropdownItem, ElDropdownMenu, ElInput } from 'element-plus'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/checkbox/style/css'
import 'element-plus/es/components/dropdown/style/css'
import 'element-plus/es/components/input/style/css'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import PageMarginsDialog from './PageMarginsDialog.vue'
import WordTableTools from './WordTableTools.vue'
import WordCellAlignment from './WordCellAlignment.vue'
import { parseFontSize } from '../WordEditor/blockFontSize'
import type { TableCellAction, TableCellAlignment, TableCellAlignmentState } from '../WordEditor/documentTable'
import { blockStyleOptions, type DocumentBlockStyle } from '../WordEditor/documentHeading'
import type { InlineFormat, InlineFormatState } from '../WordEditor/inlineFormatting'
import { pageDimensions, samePageMargins, type PageMargins, type PageOrientation } from '../WordEditor/pageGeometry'
import type { TableBorderChange, TableBorders } from '../WordEditor/tableBorders'
import type { TableSize } from '../WordEditor/tableSize'

defineOptions({ name: 'WordRibbon' })

const showRulers = defineModel<boolean>('showRulers', { default: true })
const showTableGridlines = defineModel<boolean>('showTableGridlines', { required: true })
const panelPinned = defineModel<boolean>('panelPinned', { default: true })

const props = defineProps<{
  blockStyle: DocumentBlockStyle | null
  fontSize: number | null
  canSetFontSize: boolean
  canInsertTable: boolean
  tableHeader: boolean | null
  tableNumbered: boolean | null
  tableBorders: TableBorders | null
  tableCellAction: TableCellAction | null
  tableCellAlignment: TableCellAlignmentState
  inlineFormats: InlineFormatState
  pageOrientation: PageOrientation
  pageMargins: PageMargins
}>()
const emit = defineEmits<{
  blockStyleSelect: [style: DocumentBlockStyle]
  fontSizeSelect: [size: number, focusEditor: boolean]
  inlineFormatToggle: [format: InlineFormat]
  pageOrientationSelect: [orientation: PageOrientation]
  pageMarginsSelect: [margins: PageMargins]
  tableInsert: [size: TableSize]
  tableHeaderToggle: []
  tableNumberedToggle: []
  tableColumnSettings: []
  tableBorderChange: [change: TableBorderChange]
  tableCellEdit: [action: TableCellAction]
  tableCellAlign: [alignment: TableCellAlignment]
}>()

const symmetricMargins = (vertical: number, horizontal: number): PageMargins => ({
  marginTop: vertical, marginRight: horizontal, marginBottom: vertical, marginLeft: horizontal,
})
const marginPresets = [
  { label: '普通', margins: symmetricMargins(25.4, 25.4) },
  { label: '宽', margins: symmetricMargins(25.4, 50.8) },
  { label: '窄', margins: symmetricMargins(12.7, 12.7) },
  { label: '适中', margins: symmetricMargins(25.4, 19.1) },
]
const { width: previewWidth, height: previewHeight } = pageDimensions('portrait')
const selectedMarginPreset = computed(() =>
  marginPresets.find(({ margins }) => samePageMargins(margins, props.pageMargins)),
)
const customMargins = ref<InstanceType<typeof PageMarginsDialog> | null>(null)

const orientationOptions = [
  { value: 'portrait', label: '纵向' },
  { value: 'landscape', label: '横向' },
] as const
const inlineFormatButtons = [
  { format: 'bold', symbol: 'B', label: '加粗' },
  { format: 'italic', symbol: 'I', label: '斜体' },
  { format: 'underline', symbol: 'U', label: '下划线' },
] as const
const tableCellLabels: Record<TableCellAction, string> = { merge: '合并单元格', split: '拆分单元格' }
const fontSizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]
const fontSizeControl = ref<HTMLElement | null>(null)
const fontSizeMenu = ref<InstanceType<typeof ElDropdown> | null>(null)
const fontSizeEdited = ref(false)
const fontSizeDraft = ref('')
const resetFontSizeDraft = () => {
  fontSizeDraft.value = props.fontSize?.toString() ?? ''
  fontSizeEdited.value = false
}
watch(() => props.fontSize, resetFontSizeDraft, { immediate: true })
const styleLabel = computed(() =>
  blockStyleOptions.find(option => option.value === props.blockStyle)?.label
  ?? (typeof props.blockStyle === 'number' ? `${props.blockStyle - 1}级标题` : '段落样式'),
)

const selectBlockStyle = (value: unknown) => {
  const option = blockStyleOptions.find(option => option.value === value)
  if (option) emit('blockStyleSelect', option.value)
}

const selectFontSize = (size: number, focusEditor: boolean) => {
  fontSizeDraft.value = String(size)
  fontSizeEdited.value = false
  if (focusEditor || size !== props.fontSize) emit('fontSizeSelect', size, focusEditor)
}

const commitFontSize = (focusEditor: boolean) => {
  fontSizeMenu.value?.handleClose()
  const size = parseFontSize(fontSizeDraft.value)
  if (size === null) resetFontSizeDraft()
  else selectFontSize(size, focusEditor)
}

const handleFontSizeFocusOut = (event: FocusEvent) => {
  const target = event.relatedTarget
  if (target instanceof Element && (
    fontSizeControl.value?.contains(target) || target.closest('.word-font-size-menu')
  )) return
  if (fontSizeEdited.value) commitFontSize(false)
}

const selectFontPreset = (size: unknown) => {
  if (typeof size === 'number') selectFontSize(size, true)
}

const selectPageMargins = (command: unknown) => {
  if (command === 'custom') {
    customMargins.value?.show()
    return
  }
  const preset = marginPresets.find(preset => preset.label === command)
  if (preset) emit('pageMarginsSelect', preset.margins)
}

const selectPageOrientation = (orientation: unknown) => {
  if (orientation === 'portrait' || orientation === 'landscape') {
    emit('pageOrientationSelect', orientation)
  }
}

const tabs = ['常用', '插入', '布局'] as const
type RibbonTab = (typeof tabs)[number]
const activeTab = ref<RibbonTab | null>('常用')

let singleClickTimer: ReturnType<typeof setTimeout> | null = null

const clearSingleClickTimer = () => {
  if (singleClickTimer === null) return
  window.clearTimeout(singleClickTimer)
  singleClickTimer = null
}

const selectFloatingTab = (tab: RibbonTab) => {
  if (activeTab.value === tab) {
    activeTab.value = null
    panelPinned.value = false
    return
  }

  activeTab.value = tab
  panelPinned.value = false
}

const pinTab = (tab: RibbonTab) => {
  clearSingleClickTimer()
  activeTab.value = tab
  panelPinned.value = true
}

const handleTabClick = (tab: RibbonTab, event: MouseEvent) => {
  if (event.detail >= 2) {
    pinTab(tab)
    return
  }

  clearSingleClickTimer()
  singleClickTimer = window.setTimeout(() => {
    selectFloatingTab(tab)
    singleClickTimer = null
  }, 220)
}

onBeforeUnmount(clearSingleClickTimer)
</script>

<template>
  <div class="word-ribbon">
    <nav class="word-ribbon-tabs" aria-label="编辑器功能区">
      <ElButton
        v-for="tab in tabs"
        :id="'word-tab-' + tab"
        :key="tab"
        text
        class="word-ribbon-tab"
        :class="{ 'is-active': activeTab === tab }"
        role="tab"
        :aria-selected="activeTab === tab"
        :aria-controls="activeTab === tab ? 'word-panel-' + tab : undefined"
        @click="handleTabClick(tab, $event)"
        @dblclick.prevent="pinTab(tab)"
      >
        {{ tab }}
      </ElButton>
    </nav>

    <div
      v-if="activeTab"
      class="word-ribbon-panel"
      :class="panelPinned ? 'is-pinned' : 'is-floating'"
    >
      <div
        :id="'word-panel-' + activeTab"
        class="word-ribbon-panel-content"
        :class="{ 'is-common': activeTab === '常用' }"
        role="tabpanel"
        :aria-labelledby="'word-tab-' + activeTab"
      >
        <template v-if="activeTab === '常用'">
          <section class="word-ribbon-group" aria-label="字体">
            <div class="word-ribbon-group-content word-font-controls">
              <ElDropdown
                trigger="click"
                placement="bottom-start"
                popper-class="word-style-menu"
                max-height="min(360px, 60dvh)"
                :show-arrow="false"
                :disabled="blockStyle === null"
                @command="selectBlockStyle"
              >
                <ElButton
                  class="word-style-button"
                  :aria-label="'段落样式：' + styleLabel"
                  :disabled="blockStyle === null"
                >
                  <span :class="{ 'is-heading': typeof blockStyle === 'number' }">{{ styleLabel }}</span>
                  <span class="word-style-chevron" aria-hidden="true" />
                </ElButton>
                <template #dropdown>
                  <ElDropdownMenu>
                    <ElDropdownItem
                      v-for="option in blockStyleOptions"
                      :key="option.value"
                      :command="option.value"
                      :class="{ 'is-heading': typeof option.value === 'number' }"
                      role="menuitemradio"
                      :aria-checked="blockStyle === option.value"
                    >
                      {{ option.label }}
                    </ElDropdownItem>
                  </ElDropdownMenu>
                </template>
              </ElDropdown>

              <div ref="fontSizeControl" class="word-font-size-control" @focusout="handleFontSizeFocusOut">
                <ElInput
                  v-model="fontSizeDraft"
                  inputmode="decimal"
                  aria-label="字号（pt）"
                  placeholder="字号"
                  :disabled="!canSetFontSize"
                  @input="fontSizeEdited = true"
                  @keydown.enter.prevent="commitFontSize(true)"
                  @keydown.down.prevent="fontSizeMenu?.handleOpen()"
                />
                <ElDropdown
                  ref="fontSizeMenu"
                  trigger="click"
                  placement="bottom-end"
                  popper-class="word-font-size-menu"
                  max-height="min(360px, 60dvh)"
                  :show-arrow="false"
                  :disabled="!canSetFontSize"
                  @command="selectFontPreset"
                >
                  <ElButton text class="word-font-size-toggle" aria-label="选择字号" :disabled="!canSetFontSize">
                    <span class="word-style-chevron" aria-hidden="true" />
                  </ElButton>
                  <template #dropdown>
                    <ElDropdownMenu>
                      <ElDropdownItem
                        v-for="size in fontSizes"
                        :key="size"
                        :command="size"
                        role="menuitemradio"
                        :aria-checked="fontSize === size"
                      >
                        {{ size }}
                      </ElDropdownItem>
                    </ElDropdownMenu>
                  </template>
                </ElDropdown>
              </div>

              <div class="word-inline-formats" role="group" aria-label="字符格式">
                <ElButton
                  v-for="{ format, symbol, label } in inlineFormatButtons"
                  :key="format"
                  text
                  class="word-inline-format"
                  :class="'is-' + format"
                  :aria-label="label"
                  :aria-pressed="inlineFormats[format]"
                  :title="label"
                  @mousedown.prevent
                  @click="emit('inlineFormatToggle', format)"
                >
                  {{ symbol }}
                </ElButton>
              </div>
            </div>
            <span class="word-ribbon-group-title">字体</span>
          </section>
          <WordTableTools
            v-model:show-table-gridlines="showTableGridlines"
            :disabled="!canInsertTable"
            :header="tableHeader"
            :numbered="tableNumbered"
            :borders="tableBorders"
            @insert="emit('tableInsert', $event)"
            @toggle-header="emit('tableHeaderToggle')"
            @toggle-numbered="emit('tableNumberedToggle')"
            @column-settings="emit('tableColumnSettings')"
            @border-change="emit('tableBorderChange', $event)"
          />
          <section class="word-ribbon-group" aria-label="单元格">
            <div class="word-ribbon-group-content">
              <ElButton
                text
                class="word-page-setup-button word-cell-edit-button"
                :class="{ 'is-merge': tableCellAction === 'merge' }"
                :disabled="!tableCellAction"
                @mousedown.prevent
                @click="tableCellAction && emit('tableCellEdit', tableCellAction)"
              >
                <span class="word-cell-edit-icon" aria-hidden="true" />
                <span>{{ tableCellAction ? tableCellLabels[tableCellAction] : '合并/拆分单元格' }}</span>
              </ElButton>
              <WordCellAlignment :state="tableCellAlignment" @align="emit('tableCellAlign', $event)" />
            </div>
            <span class="word-ribbon-group-title">单元格</span>
          </section>
          <section class="word-ribbon-group" aria-label="显示">
            <div class="word-ribbon-group-content">
              <ElCheckbox v-model="showRulers" class="word-ribbon-checkbox">标尺</ElCheckbox>
            </div>
            <span class="word-ribbon-group-title">显示</span>
          </section>
        </template>

        <WordTableTools
          v-else-if="activeTab === '插入'"
          insert-only
          :disabled="!canInsertTable"
          @insert="emit('tableInsert', $event)"
        />

        <section v-else-if="activeTab === '布局'" class="word-ribbon-group" aria-label="页面设置">
          <div class="word-ribbon-group-content word-page-setup-controls">
            <ElDropdown
              trigger="click"
              placement="bottom-start"
              popper-class="word-margins-menu"
              max-height="min(360px, 60dvh)"
              :show-arrow="false"
              @command="selectPageMargins"
            >
              <ElButton text class="word-page-setup-button word-margins-button">
                <span class="word-margins-icon" aria-hidden="true"><span class="word-margins-guide" /></span>
                <span class="word-page-setup-label">
                  页边距
                  <span class="word-style-chevron" aria-hidden="true" />
                </span>
              </ElButton>
              <template #dropdown>
                <ElDropdownMenu>
                  <ElDropdownItem
                    v-for="preset in marginPresets"
                    :key="preset.label"
                    :command="preset.label"
                    class="word-margins-option"
                    role="menuitemradio"
                    :aria-checked="selectedMarginPreset === preset"
                  >
                    <span
                      class="word-margin-preview"
                      :style="{
                        '--margin-preview-y': (preset.margins.marginTop / previewHeight * 100) + '%',
                        '--margin-preview-x': (preset.margins.marginLeft / previewWidth * 100) + '%',
                      }"
                      aria-hidden="true"
                    />
                    <span>
                      <span class="word-margin-preset-label">{{ preset.label }}</span>
                      <span class="word-margin-preset-values">
                        上下 {{ (preset.margins.marginTop / 10).toFixed(2) }} · 左右 {{ (preset.margins.marginLeft / 10).toFixed(2) }} cm
                      </span>
                    </span>
                  </ElDropdownItem>
                  <ElDropdownItem command="custom" class="word-margins-custom" aria-haspopup="dialog" divided>
                    自定义页边距…
                  </ElDropdownItem>
                </ElDropdownMenu>
              </template>
            </ElDropdown>
            <ElDropdown
              trigger="click"
              placement="bottom-start"
              popper-class="word-orientation-menu"
              :show-arrow="false"
              @command="selectPageOrientation"
            >
              <ElButton text class="word-page-setup-button word-orientation-button">
                <span class="word-orientation-icon" aria-hidden="true" />
                <span class="word-page-setup-label word-orientation-label">
                  纸张方向
                  <span class="word-style-chevron" aria-hidden="true" />
                </span>
              </ElButton>
              <template #dropdown>
                <ElDropdownMenu>
                  <ElDropdownItem
                    v-for="{ value, label } in orientationOptions"
                    :key="value"
                    :command="value"
                    class="word-orientation-option"
                    role="menuitemradio"
                    :aria-checked="pageOrientation === value"
                  >
                    <span class="word-orientation-option-icon" :class="'is-' + value" aria-hidden="true" />
                    {{ label }}
                  </ElDropdownItem>
                </ElDropdownMenu>
              </template>
            </ElDropdown>
          </div>
          <span class="word-ribbon-group-title">页面设置</span>
        </section>
      </div>
    </div>
    <PageMarginsDialog
      ref="customMargins"
      :margins="pageMargins"
      :orientation="pageOrientation"
      @apply="emit('pageMarginsSelect', $event)"
    />
  </div>
</template>

<style src="./WordRibbon.css"></style>
