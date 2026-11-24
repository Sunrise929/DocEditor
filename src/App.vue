<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElConfigProvider } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'

import WordEditor from './components/WordEditor/WordEditor.vue'
import WordRibbon from './components/WordRibbon/WordRibbon.vue'
import WordTitleBar from './components/WordTitleBar/WordTitleBar.vue'
import type { CellLine, CellLineState } from './components/WordEditor/cellLines'
import type { TableCellAlignment, TableCellAlignmentState } from './components/WordEditor/documentTable'
import type { DocumentBlockStyle } from './components/WordEditor/documentHeading'
import type { InlineFormat, InlineFormatState } from './components/WordEditor/inlineFormatting'
import { DEFAULT_PAGE_MARGINS, type PageMargins, type PageOrientation } from './components/WordEditor/pageGeometry'
import type { TableSize } from './components/WordEditor/tableSize'

type WordEditorApi = {
  getJSON: () => unknown
  undo: () => boolean
  redo: () => boolean
  setBlockStyle: (style: DocumentBlockStyle) => void
  setBlockFontSize: (size: number, focusEditor: boolean) => void
  toggleInlineFormat: (format: InlineFormat) => void
  setCurrentPageOrientation: (orientation: PageOrientation) => void
  setCurrentPageMargins: (margins: PageMargins) => void
  insertTable: (size: TableSize) => void
  toggleTableNumbered: () => void
  showTableColumnSettings: () => void
  alignTableCells: (alignment: TableCellAlignment) => void
  setTableCellLine: (line: CellLine | null) => void
  showTableBorders: () => void
}

const wordEditor = ref<WordEditorApi | null>(null)
const showRulers = ref(true)
const showTableGridlines = ref(true)
const ribbonPanelPinned = ref(true)
const blockStyle = ref<DocumentBlockStyle | null>(1)
const blockFontSize = ref<number | null>(null)
const canSetFontSize = ref(true)
const canInsertTable = ref(true)
const tableNumbered = ref<boolean | null>(null)
const tableCellLine = ref<CellLineState>({ available: false, line: null, canRemove: false })
const tableCellAlignment = ref<TableCellAlignmentState>({ available: false, alignment: null })
const inlineFormats = reactive<InlineFormatState>({ bold: false, italic: false, underline: false })
const pageOrientation = ref<PageOrientation>('portrait')
const pageMargins = ref<PageMargins>({ ...DEFAULT_PAGE_MARGINS })

const syncFontSize = (size: number | null, available: boolean) => {
  blockFontSize.value = size
  canSetFontSize.value = available
}

const saveDocument = () => {
  const json = wordEditor.value?.getJSON()
  if (json) console.log(json)
}
</script>

<template>
  <ElConfigProvider :locale="zhCn">
    <div class="word-editor-shell">
      <WordTitleBar
        @save="saveDocument"
        @undo="wordEditor?.undo()"
        @redo="wordEditor?.redo()"
      />
      <WordRibbon
        v-model:show-rulers="showRulers"
        v-model:show-table-gridlines="showTableGridlines"
        v-model:panel-pinned="ribbonPanelPinned"
        :block-style="blockStyle"
        :font-size="blockFontSize"
        :can-set-font-size="canSetFontSize"
        :can-insert-table="canInsertTable"
        :table-numbered="tableNumbered"
        :table-cell-alignment="tableCellAlignment"
        :table-cell-line="tableCellLine"
        :inline-formats="inlineFormats"
        :page-orientation="pageOrientation"
        :page-margins="pageMargins"
        @block-style-select="wordEditor?.setBlockStyle($event)"
        @font-size-select="(size, focusEditor) => wordEditor?.setBlockFontSize(size, focusEditor)"
        @inline-format-toggle="wordEditor?.toggleInlineFormat($event)"
        @page-orientation-select="wordEditor?.setCurrentPageOrientation($event)"
        @page-margins-select="wordEditor?.setCurrentPageMargins($event)"
        @table-insert="wordEditor?.insertTable($event)"
        @table-numbered-toggle="wordEditor?.toggleTableNumbered()"
        @table-column-settings="wordEditor?.showTableColumnSettings()"
        @table-borders-open="wordEditor?.showTableBorders()"
        @table-cell-align="wordEditor?.alignTableCells($event)"
        @table-cell-line="wordEditor?.setTableCellLine($event)"
      />
      <WordEditor
        ref="wordEditor"
        :show-rulers="showRulers"
        :show-table-gridlines="showTableGridlines"
        :ribbon-panel-pinned="ribbonPanelPinned"
        @block-style-change="blockStyle = $event"
        @block-font-size-change="syncFontSize"
        @inline-formats-change="Object.assign(inlineFormats, $event)"
        @page-orientation-change="pageOrientation = $event"
        @page-margins-change="pageMargins = $event"
        @table-insertion-availability-change="canInsertTable = $event"
        @table-numbered-change="tableNumbered = $event"
        @table-cell-alignment-change="tableCellAlignment = $event"
        @table-cell-line-change="tableCellLine = $event"
      />
    </div>
  </ElConfigProvider>
</template>

<style src="./components/AppLayout.css"></style>
