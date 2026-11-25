<script setup lang="ts">
import { ElButton, ElSwitch } from 'element-plus'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/switch/style/css'

defineOptions({ name: 'WordTitleBar' })

const emit = defineEmits<{
  save: []
  printJson: []
  undo: []
  redo: []
}>()
</script>

<template>
  <header class="word-titlebar">
    <div class="word-titlebar-actions">
      <div class="word-autosave" title="自动保存功能暂未启用">
        <span>自动保存</span>
        <ElSwitch
          class="word-autosave-switch"
          :model-value="false"
          :width="34"
          aria-label="自动保存"
          size="small"
          disabled
        />
      </div>

      <span class="word-titlebar-divider" aria-hidden="true" />

      <ElButton
        text
        class="word-titlebar-button"
        title="保存"
        aria-label="保存"
        @click="emit('save')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 3h12l2 2v16H5z" />
          <path d="M8 3v6h8V3M8 21v-8h8v8" />
        </svg>
      </ElButton>

      <ElButton
        text
        class="word-titlebar-button"
        title="打印 JSON"
        aria-label="打印 JSON"
        @click="emit('printJson')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 4H7a2 2 0 0 0-2 2v3l-2 3 2 3v3a2 2 0 0 0 2 2h2" />
          <path d="M15 4h2a2 2 0 0 1 2 2v3l2 3-2 3v3a2 2 0 0 1-2 2h-2" />
        </svg>
      </ElButton>

      <ElButton
        text
        class="word-titlebar-button"
        title="撤销"
        aria-label="撤销"
        @click="emit('undo')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 7 4 12l5 5" />
          <path d="M5 12h8a6 6 0 0 1 6 6" />
        </svg>
      </ElButton>

      <ElButton
        text
        class="word-titlebar-button"
        title="恢复"
        aria-label="恢复"
        @click="emit('redo')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 7 5 5-5 5" />
          <path d="M19 12h-8a6 6 0 0 0-6 6" />
        </svg>
      </ElButton>
      
    </div>
  </header>
</template>

<style src="./WordTitleBar.css"></style>
