export const TABLE_EDGE_HIT_DISTANCE = 5

export const visibleTableBounds = (table: HTMLTableElement, box = table.getBoundingClientRect()) => {
  const wrapper = table.parentElement
  if (!wrapper) return null

  const frame = wrapper.getBoundingClientRect()
  const canvas = table.closest('.word-editor-canvas')
  const ribbonBottom = canvas ? parseFloat(getComputedStyle(canvas).getPropertyValue('--word-ribbon-bottom')) || 0 : 0
  const ruler = canvas?.querySelector<HTMLElement>('.word-horizontal-ruler-shell')
  const floatingRibbon = canvas?.parentElement?.querySelector('.word-ribbon-panel.is-floating')
  const viewportTop = Math.max(ribbonBottom + (ruler?.offsetHeight ?? 0), floatingRibbon?.getBoundingClientRect().bottom ?? 0)
  const frameRight = frame.right - (wrapper.offsetWidth - wrapper.clientWidth)
  const frameBottom = frame.bottom - (wrapper.offsetHeight - wrapper.clientHeight)
  const left = Math.max(frame.left, box.left, 0)
  const right = Math.min(frameRight, box.right, document.documentElement.clientWidth)
  const top = Math.max(frame.top, box.top, viewportTop)
  const bottom = Math.min(frameBottom, box.bottom, document.documentElement.clientHeight)
  return left < right && top < bottom ? { left, right, top, bottom, viewportTop } : null
}

export const readTableColumns = (table: HTMLTableElement, count: number) => {
  const columns = Array.from(table.querySelectorAll(':scope > colgroup > col'))
  if (columns.length !== count || !count) return null

  const rects = columns.map(column => column.getBoundingClientRect())
  if (rects.some(rect => !rect.width)) return null
  const first = rects[0]!
  const edges = [first.left, ...rects.map(rect => rect.right)]
  return { edges }
}
