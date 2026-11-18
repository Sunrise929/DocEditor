<script setup lang="ts">
defineOptions({ name: 'WordTitleBar' })

const emit = defineEmits<{
  save: []
  undo: []
  redo: []
}>()
</script>

<template>
  <header class="word-titlebar">
    <div class="word-titlebar-actions">
      <div class="word-autosave" title="自动保存功能暂未启用">
        <span>自动保存</span>
        <span
          class="word-autosave-switch"
          role="switch"
          aria-checked="false"
          aria-disabled="true"
        >
          <span class="word-autosave-thumb" />
        </span>
      </div>

      <span class="word-titlebar-divider" aria-hidden="true" />

      <button
        type="button"
        class="word-titlebar-button"
        title="保存"
        aria-label="保存"
        @click="emit('save')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 3h12l2 2v16H5z" />
          <path d="M8 3v6h8V3M8 21v-8h8v8" />
        </svg>
      </button>

      <button
        type="button"
        class="word-titlebar-button"
        title="撤销"
        aria-label="撤销"
        @click="emit('undo')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 7 4 12l5 5" />
          <path d="M5 12h8a6 6 0 0 1 6 6" />
        </svg>
      </button>

      <button
        type="button"
        class="word-titlebar-button"
        title="恢复"
        aria-label="恢复"
        @click="emit('redo')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 7 5 5-5 5" />
          <path d="M19 12h-8a6 6 0 0 0-6 6" />
        </svg>
      </button>
    </div>

    <div class="word-document-title">文档编辑器</div>
  </header>
</template>

<style src="./WordTitleBar.css"></style>
