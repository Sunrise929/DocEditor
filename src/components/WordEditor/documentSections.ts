import { Extension, Node, type Editor, type JSONContent } from '@tiptap/core'
import { Fragment, Slice, type Node as ProseMirrorNode, type ResolvedPos } from '@tiptap/pm/model'
import { AllSelection, Plugin, TextSelection, type Transaction } from '@tiptap/pm/state'
import { dropPoint } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export type SectionAction = 'split' | 'insert' | 'merge' | 'rename'
export type SectionStatus = { number: number; name: string; total: number; canSplit: boolean }

export type SectionEntry = {
  node: ProseMirrorNode
  pos: number
  index: number
  firstPage: number
  id: string
}
export type PageEntry = {
  node: ProseMirrorNode
  pos: number
  index: number
  localIndex: number
  section: SectionEntry
}

export const newSectionId = () => globalThis.crypto.randomUUID?.()
  ?? Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), part => part.toString(16).padStart(8, '0')).join('-')

const indexes = new WeakMap<Fragment, { sections: SectionEntry[]; pages: PageEntry[]; byId: Map<string, SectionEntry> }>()

export const documentLayout = (doc: ProseMirrorNode) => {
  const cached = indexes.get(doc.content)
  if (cached) return cached

  const sections: SectionEntry[] = []
  const pages: PageEntry[] = []
  const byId = new Map<string, SectionEntry>()
  doc.forEach((node, pos, index) => {
    const id = node.attrs.id as string
    const section = { node, pos, index, firstPage: pages.length, id }
    sections.push(section)
    byId.set(id, section)
    node.forEach((page, offset, localIndex) => {
      pages.push({ node: page, pos: pos + 1 + offset, index: pages.length, localIndex, section })
    })
  })
  const layout = { sections, pages, byId }
  indexes.set(doc.content, layout)
  return layout
}

export const forEachDocumentPage = (
  doc: ProseMirrorNode,
  callback: (page: ProseMirrorNode, pos: number, index: number) => void,
) => documentLayout(doc).pages.forEach(({ node, pos, index }) => callback(node, pos, index))

export const pageAtPosition = (doc: ProseMirrorNode, position: number): PageEntry | undefined => {
  const { pages } = documentLayout(doc)
  let low = 0
  let high = pages.length
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (pages[mid]!.pos <= position) low = mid + 1
    else high = mid
  }
  const page = pages[low - 1]
  return page && position <= page.pos + page.node.nodeSize ? page : undefined
}

export const documentPageElements = (root: HTMLElement) =>
  root.querySelectorAll<HTMLElement>(':scope > [data-document-section] > [data-page]')

export const sectionLabel = (number: number, name: string) => name ? `第 ${number} 节 · ${name}` : `第 ${number} 节`

export const sectionBlockBoundary = ($pos: ResolvedPos) => {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === 'page') return $pos.posAtIndex($pos.index(depth), depth)
  }
  return null
}

export const createBlankDocument = (): JSONContent => ({
  type: 'doc',
  content: [{
    type: 'section',
    attrs: { id: newSectionId() },
    content: [{ type: 'page', content: [{ type: 'paragraph' }] }],
  }],
})

export const DocumentSection = Node.create({
  name: 'section',
  content: 'page+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      id: { default: null, parseHTML: element => element.getAttribute('data-section-id'),
        renderHTML: attrs => ({ 'data-section-id': attrs.id }) },
      name: { default: '', parseHTML: element => element.getAttribute('data-section-name') ?? '',
        renderHTML: attrs => ({ 'data-section-name': attrs.name }) },
    }
  },
  parseHTML() { return [{ tag: 'div[data-document-section]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', { ...HTMLAttributes, 'data-document-section': '' }, 0] },
})

export const emptyPage = (doc: ProseMirrorNode, template?: ProseMirrorNode | null) =>
  doc.type.schema.nodes.page!.create(template?.attrs, doc.type.schema.nodes.paragraph!.create())

const sectionEditing = new Plugin({
  appendTransaction(transactions, _previous, { doc, tr }) {
    if (!transactions.some(transaction => transaction.docChanged)) return null
    const ids = new Set<string>()
    for (const section of documentLayout(doc).sections) {
      const id = section.id && !ids.has(section.id) ? section.id : newSectionId()
      ids.add(id)
      if (id !== section.id) tr.setNodeAttribute(tr.mapping.map(section.pos), 'id', id)
      if (section.node.childCount === 1 && section.node.firstChild?.childCount === 0) {
        tr.insert(tr.mapping.map(section.pos + 2), doc.type.schema.nodes.paragraph!.create())
      }
    }
    return tr.docChanged ? tr : null
  },
  props: {
    handleKeyDown(view, event) {
      if (event.isComposing || (event.key !== 'Backspace' && event.key !== 'Delete' && event.key !== 'Enter')) return false
      const tr = deleteAcrossSections(view.state.tr)
      if (!tr) return false
      if (event.key === 'Enter') {
        // Let the normal Enter command handle the remaining cursor in its original block.
        view.dispatch(tr)
        return false
      }
      view.dispatch(tr.scrollIntoView())
      return true
    },
    handleTextInput(view, from, to, text) {
      const tr = deleteAcrossSections(view.state.tr, from, to)
      if (!tr) return false
      view.dispatch(tr.insertText(text).scrollIntoView())
      return true
    },
    handlePaste(view, _event, slice) {
      const tr = deleteAcrossSections(view.state.tr)
      if (!tr) return false
      view.dispatch(tr.replaceSelection(slice).setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView())
      return true
    },
    handleDrop(view, event, slice, moved) {
      if (!moved) return false
      const { state } = view
      const tr = deleteAcrossSections(state.tr)
      if (!tr) return false

      const target = view.posAtCoords({ left: event.clientX, top: event.clientY })
      if (!target || (target.pos >= state.selection.from && target.pos <= state.selection.to)) return true
      const insertAt = tr.mapping.map(target.pos)
      const destination = dropPoint(tr.doc, insertAt, slice) ?? insertAt
      const page = pageAtPosition(tr.doc, destination)
      if (!page || destination <= page.pos || destination >= page.pos + page.node.nodeSize) return true

      const deleted = tr.doc
      tr.replaceRange(destination, destination, slice)
      if (!tr.doc.eq(deleted)) view.dispatch(tr.setMeta('uiEvent', 'drop').scrollIntoView())
      return true
    },
    handleDOMEvents: {
      beforeinput(view, event) {
        if (!event.cancelable || !event.inputType.startsWith('delete') || event.inputType === 'deleteByCut') return false
        const tr = deleteAcrossSections(view.state.tr)
        if (!tr) return false
        event.preventDefault()
        view.dispatch(tr.scrollIntoView())
        return true
      },
      cut(view, event) {
        if (!event.clipboardData) return false
        const tr = deleteAcrossSections(view.state.tr)
        if (!tr) return false
        const { dom, text } = view.serializeForClipboard(view.state.selection.content())
        event.preventDefault()
        event.clipboardData.setData('text/html', dom.innerHTML)
        event.clipboardData.setData('text/plain', text)
        view.dispatch(tr.scrollIntoView().setMeta('uiEvent', 'cut'))
        return true
      },
    },
  },
})

function deleteAcrossSections(tr: Transaction, from = tr.selection.from, to = tr.selection.to) {
  const { doc, selection } = tr
  if (from === to) return null
  const { sections } = documentLayout(doc)
  const affected = sections.filter(section =>
    from < section.pos + section.node.nodeSize - 1 && to > section.pos + 1)
  if (affected.length < 2 && !(selection instanceof AllSelection)) return null

  for (const section of affected.reverse()) {
    const start = section.pos + 1
    const end = section.pos + section.node.nodeSize - 1
    if (from <= start && to >= end) {
      tr.replaceWith(start, end, emptyPage(doc, section.node.firstChild))
    } else {
      tr.replace(Math.max(from, start), Math.min(to, end), Slice.empty)
    }
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(from)), 1))
  return tr
}

export const sectionControls = (rename: (id: string) => void) => Extension.create({
  name: 'sectionControls',
  priority: 1000,
  addProseMirrorPlugins() {
    const labels = new WeakMap<Fragment, DecorationSet>()
    return [sectionEditing, new Plugin({
      props: {
        decorations({ doc }) {
          const cached = labels.get(doc.content)
          if (cached) return cached
          const decorations = DecorationSet.create(doc, documentLayout(doc).sections.map(section => {
            const { id, index, pos, node } = section
            const name = String(node.attrs.name ?? '')
            return Decoration.widget(pos + 1, () => {
              const label = document.createElement('div')
              label.className = 'word-section-label'
              const number = document.createElement('span')
              number.textContent = `第 ${index + 1} 节`
              label.append(number)
              if (name) {
                const title = document.createElement('span')
                title.className = 'word-section-name'
                title.textContent = '· ' + name
                title.title = name
                label.append(title)
              }
              const button = document.createElement('button')
              button.type = 'button'
              button.className = 'word-section-rename'
              button.title = '重命名节'
              button.setAttribute('aria-label', `重命名第 ${index + 1} 节`)
              button.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" aria-hidden="true"><path d="m3 10 7-7 3 3-7 7-3 1zM9 4l3 3"/></svg>'
              button.addEventListener('mousedown', event => event.preventDefault())
              button.addEventListener('click', () => rename(id))
              label.append(button)
              return label
            }, { key: JSON.stringify([id, index, name]), side: 0, stopEvent: () => true })
          }))
          labels.set(doc.content, decorations)
          return decorations
        },
      },
    })]
  },
})

export const currentSection = (editor: Editor) => {
  const { state } = editor
  return pageAtPosition(state.doc, state.selection.head)?.section
    ?? documentLayout(state.doc).sections.at(-1)
}
