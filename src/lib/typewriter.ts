import { Editor } from '@tiptap/react'

export function centreCursorInScroller(editor: Editor, scroller: HTMLElement): void {
  if (!editor || editor.isDestroyed) return
  const { from } = editor.state.selection

  let cursorAbsTop: number | null = null
  try {
    const coords = editor.view.coordsAtPos(from)
    const scRect = scroller.getBoundingClientRect()
    cursorAbsTop = coords.top - scRect.top + scroller.scrollTop
  } catch {
    // Fallback: locate the block containing the cursor
    try {
      const $pos = editor.state.doc.resolve(from)
      const blockPos = $pos.before(1)
      const node = editor.view.nodeDOM(blockPos)
      const el = node && (node.nodeType === 1 ? (node as HTMLElement) : (node as Node).parentElement)
      if (el) {
        const elRect = el.getBoundingClientRect()
        const scRect = scroller.getBoundingClientRect()
        cursorAbsTop = elRect.top - scRect.top + scroller.scrollTop
      }
    } catch { /* give up */ }
  }
  if (cursorAbsTop == null) return

  const target = cursorAbsTop - scroller.clientHeight / 2
  const max = scroller.scrollHeight - scroller.clientHeight
  scroller.scrollTop = Math.max(0, Math.min(target, max))
}
