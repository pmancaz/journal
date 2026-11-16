// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import Editor, { EditorBridge } from './Editor'
import { EditorView } from '@tiptap/pm/view'

let root: Root | undefined
let bridge: EditorBridge | null = null
const changed = vi.fn()
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  document.body.innerHTML = ''; bridge = null; changed.mockReset()
})
async function mount(html: string, options: { autoFocus?: boolean; typewriterMode?: boolean } = {}) {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const element = document.createElement('div'); document.body.append(element)
  root = createRoot(element)
  await act(async () => root!.render(<Editor variant="focus" value={html} autoFocus={options.autoFocus} onChange={changed} typewriterMode={options.typewriterMode ?? false} scrollToDate={null} onScrollToDateDone={() => {}} onBridgeReady={value => { bridge = value }} />))
}
it('does not rewrite an untouched imported entry merely to take a save snapshot', async () => {
  const html = '<p data-source="preserve"><span style="color:navy">Imported &amp; untouched</span></p>'
  await mount(html)
  expect(bridge).not.toBeNull()
  expect(bridge!.getLatestHtml()).toBe(html)
  expect(changed).not.toHaveBeenCalled()
})
it('flushes a real pending edit immediately and restores original imported HTML after undo', async () => {
  const html = '<p data-source="preserve"><span style="color:navy">Unchanged text</span></p>'
  await mount(html)
  act(() => bridge!.insertImageDataUrl('data:image/png;base64,AA==', 'Synthetic image'))
  const edited = bridge!.getLatestHtml()
  expect(edited).toContain('<img')
  expect(changed).toHaveBeenCalledOnce()
  act(() => bridge!.runNativeCommand!('undo'))
  expect(bridge!.getLatestHtml()).toBe(html)
  expect(changed).toHaveBeenCalledTimes(2)
})
it('does not deliver a pending edit into a replacement document or normalize its untouched markup', async () => {
  await mount('<p>First document</p>')
  act(() => bridge!.insertImageDataUrl('data:image/png;base64,AA==', 'Synthetic image'))
  const replacement = '<p data-keep="yes"><span>Replacement document</span></p>'
  await act(async () => root!.render(<Editor variant="focus" value={replacement} onChange={changed} typewriterMode={false} scrollToDate={null} onScrollToDateDone={() => {}} onBridgeReady={value => { bridge = value }} />))
  expect(bridge!.getLatestHtml()).toBe(replacement)
  await act(async () => new Promise(resolve => setTimeout(resolve, 300)))
  expect(changed).not.toHaveBeenCalled()
})

it('autofocus and existing-day focus do not schedule a later scrollIntoView after typewriter centering', async () => {
  const frames = new Map<number, FrameRequestCallback>(); let id = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame))
  const scrolling = vi.spyOn(EditorView.prototype as unknown as { scrollToSelection: () => void }, 'scrollToSelection').mockImplementation(() => {})
  try {
    await mount('<p>Text to focus</p>', { autoFocus: true, typewriterMode: true })
    scrolling.mockClear()
    const advance = () => { const current = [...frames.values()]; frames.clear(); current.forEach(callback => callback(0)) }
    act(advance); act(advance)
    expect(scrolling).not.toHaveBeenCalled()
    act(() => bridge!.runNativeCommand!('focus'))
    act(advance); act(advance)
    expect(scrolling).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals(); scrolling.mockRestore()
  }
})
