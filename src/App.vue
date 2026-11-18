<script setup lang="ts">
import { ref } from 'vue'

import WordEditor from './components/WordEditor/WordEditor.vue'
import WordRibbon from './components/WordRibbon/WordRibbon.vue'
import WordTitleBar from './components/WordTitleBar/WordTitleBar.vue'

type WordEditorApi = {
  getJSON: () => unknown
  undo: () => boolean
  redo: () => boolean
}

const wordEditor = ref<WordEditorApi | null>(null)
const showRulers = ref(true)
const ribbonPanelPinned = ref(true)

const saveDocument = () => {
  const json = wordEditor.value?.getJSON()
  if (json) console.log(json)
}
</script>

<template>
  <div class="word-editor-shell">
    <WordTitleBar
      @save="saveDocument"
      @undo="wordEditor?.undo()"
      @redo="wordEditor?.redo()"
    />
    <WordRibbon
      v-model:show-rulers="showRulers"
      v-model:panel-pinned="ribbonPanelPinned"
    />
    <WordEditor
      ref="wordEditor"
      :show-rulers="showRulers"
      :ribbon-panel-pinned="ribbonPanelPinned"
    />
  </div>
</template>

<style src="./components/AppLayout.css"></style>
