import type { JSONContent } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { sectionedContent } from './documentSections'

const storageKey = 'doceditor.document'

export const writeLocalDocument = (document: JSONContent) => {
  window.localStorage.setItem(storageKey, JSON.stringify(document))
}

export const readLocalDocument = (schema: Schema): JSONContent | undefined => {
  const saved = window.localStorage.getItem(storageKey)
  if (saved === null) return undefined

  const parsed: unknown = JSON.parse(saved)
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed) || parsed.type !== schema.topNodeType.name) {
    throw new Error('Invalid document root')
  }

  const content = sectionedContent(parsed as JSONContent)
  schema.nodeFromJSON(content).check()
  return content
}
