<script setup lang="ts">
import { ElButton } from 'element-plus'

defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ openBorders: [] }>()
</script>

<template>
  <ElButton
    text
    class="word-page-setup-button word-table-border-button"
    :disabled="disabled"
    aria-haspopup="dialog"
    @mousedown.prevent
    @click="emit('openBorders')"
  >
    <span class="word-border-grid" aria-hidden="true" />
    <span>表格边框</span>
  </ElButton>
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

.word-table-border-button .word-border-grid {
  border-color: #485f7a;
  background-color: #eef2f8;
}
</style>
