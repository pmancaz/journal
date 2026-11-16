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

// Coalesce centering until WebKit has laid out the edited paragraph. In
// particular, deleting a wrapped paragraph can change its height after the
// transaction callback. A stale pre-layout scroll leaves an empty caret offscreen.
export function createCursorCenterScheduler() {
  let frame: number | null = null
  const cancel = () => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
  }
  return {
    cancel,
    schedule(editor: Editor, scroller: HTMLElement) {
      cancel()
      const document = editor.state.doc
      const selection = editor.state.selection
      if (!selection.empty) return
      frame = requestAnimationFrame(() => {
        frame = null
        // Do not turn a subsequent click or drag into an unexpected scroll.
        if (editor.isDestroyed || editor.state.doc !== document || !editor.state.selection.eq(selection)) return
        centreCursorInScroller(editor, scroller)
      })
    },
  }
}
