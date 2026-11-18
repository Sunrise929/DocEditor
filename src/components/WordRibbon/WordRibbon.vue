<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

defineOptions({ name: 'WordRibbon' })

const showRulers = defineModel<boolean>('showRulers', { default: true })
const panelPinned = defineModel<boolean>('panelPinned', { default: true })

const tabs = ['开始', '插入', '布局'] as const
type RibbonTab = (typeof tabs)[number]
const activeTab = ref<RibbonTab | null>('开始')

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
      <button
        v-for="tab in tabs"
        :id="`word-tab-${tab}`"
        :key="tab"
        type="button"
        class="word-ribbon-tab"
        :class="{ 'is-active': activeTab === tab }"
        role="tab"
        :aria-selected="activeTab === tab"
        :aria-controls="`word-panel-${tab}`"
        @click="handleTabClick(tab, $event)"
        @dblclick.prevent="pinTab(tab)"
      >
        {{ tab }}
      </button>
    </nav>

    <div
      v-if="activeTab"
      class="word-ribbon-panel"
      :class="panelPinned ? 'is-pinned' : 'is-floating'"
    >
      <div
        v-for="tab in tabs"
        v-show="activeTab === tab"
        :id="`word-panel-${tab}`"
        :key="tab"
        class="word-ribbon-panel-content"
        role="tabpanel"
        :aria-labelledby="`word-tab-${tab}`"
      >
        <section v-if="tab === '开始'" class="word-ribbon-group" aria-label="显示">
          <div class="word-ribbon-group-content">
            <label class="word-ribbon-checkbox">
              <input v-model="showRulers" type="checkbox" />
              <span>标尺</span>
            </label>
          </div>
          <span class="word-ribbon-group-title">显示</span>
        </section>
      </div>
    </div>
  </div>
</template>

<style src="./WordRibbon.css"></style>
