// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { createCursorCenterScheduler } from './typewriter'

let frames: Map<number, FrameRequestCallback>
let editor: Editor
let nextFrame: number
beforeEach(() => {
  frames = new Map(); nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit], content: '<p>Initial text</p>' })
})
afterEach(() => { editor.destroy(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function frame() {
  const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback(0))
}
function viewport() {
  return { scrollTop: 0, clientHeight: 200, scrollHeight: 1000, getBoundingClientRect: () => ({ top: 0 }) } as HTMLElement
}
it('coalesces edit bursts and measures the caret after the next layout rather than using old paragraph geometry', () => {
  let top = 600
  const coords = vi.spyOn(editor.view, 'coordsAtPos').mockImplementation(() => ({ top, bottom: top + 20, left: 0, right: 0 }))
  const scroller = viewport(); const scheduler = createCursorCenterScheduler()
  scheduler.schedule(editor, scroller); scheduler.schedule(editor, scroller)
  expect(coords).not.toHaveBeenCalled()
  top = 150 // Layout after deleting a previously wrapped paragraph.
  frame()
  expect(coords).toHaveBeenCalledOnce()
  expect(scroller.scrollTop).toBe(50)
})
it('does not recenter a subsequent drag selection', () => {
  const coords = vi.spyOn(editor.view, 'coordsAtPos')
  const scheduler = createCursorCenterScheduler()
  scheduler.schedule(editor, viewport())
  editor.commands.setTextSelection({ from: 1, to: 5 })
  frame()
  expect(coords).not.toHaveBeenCalled()
})
it('cancels pending work when disabled or unmounted and ignores destroyed editors', () => {
  const coords = vi.spyOn(editor.view, 'coordsAtPos')
  const scheduler = createCursorCenterScheduler()
  scheduler.schedule(editor, viewport()); scheduler.cancel(); frame()
  expect(coords).not.toHaveBeenCalled()
  scheduler.schedule(editor, viewport()); editor.destroy(); frame()
  expect(coords).not.toHaveBeenCalled()
})
