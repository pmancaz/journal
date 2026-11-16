import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Node } from '@tiptap/pm/model'
import { isSameDay, parseHeadingDate } from './dates'

const imagePositions = new PluginKey<Map<string, number>>('pendingJournalImages')

// Keep each unfinished image's position aligned with edits made while its file
// loads. Replacing/deleting that part of the document cancels the insertion.
export function pendingImagePlugin() {
  return new Plugin({
    key: imagePositions,
    state: {
      init: () => new Map<string, number>(),
      apply(transaction, previous) {
        const next = new Map<string, number>()
        previous.forEach((position, id) => {
          const mapped = transaction.mapping.mapResult(position)
          if (!mapped.deleted) next.set(id, mapped.pos)
        })
        const change = transaction.getMeta(imagePositions)
        if (change?.add) next.set(change.add, change.position)
        if (change?.remove) next.delete(change.remove)
        return next
      },
    },
  })
}

export async function insertLoadedImage(
  view: EditorView,
  load: () => Promise<{ src: string; name: string }>,
  position = view.state.selection.from,
): Promise<void> {
  if (view.isDestroyed || !view.editable) return
  const id = crypto.randomUUID()
  view.dispatch(view.state.tr.setMeta(imagePositions, { add: id, position }))
  try {
    const image = await load()
    // Switching journals creates a different editor. Never send a completed
    // file read to its replacement, or modify a now-protected draft.
    if (view.isDestroyed || !view.editable) return
    const mappedPosition = imagePositions.getState(view.state)?.get(id)
    const imageType = view.state.schema.nodes.image
    if (mappedPosition === undefined || !imageType) return
    const transaction = view.state.tr
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(mappedPosition)))
    view.dispatch(transaction.replaceSelectionWith(imageType.create({ src: image.src, alt: image.name })).scrollIntoView())
  } finally {
    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(imagePositions, { remove: id }))
  }
}

// Indexing, Focus, and scrolling all recognise the same dated H2 headings,
// including older compact dates. Ordinary subheadings stay within an entry.
export function findEntryEnd(document: Node, date: Date): number | null {
  let start: number | null = null
  let end = document.content.size
  document.forEach((node, position) => {
    const headingDate = node.type.name === 'heading' && node.attrs.level === 2
      ? parseHeadingDate(node.textContent) : null
    if (!headingDate) return
    if (start !== null && end === document.content.size) end = position
    if (isSameDay(headingDate, date)) {
      start = position
      end = document.content.size
    }
  })
  return start === null ? null : Math.max(start + 1, end - 1)
}
