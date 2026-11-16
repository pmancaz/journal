// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor as TiptapEditor } from '@tiptap/core'
import type { JournalRevision, SaveResult } from './lib/journalDocument'

// Exercise the actual React app and TipTap editors. Only disk access and the
// native window boundary are replaced, so private files are never involved.
const fixture = vi.hoisted(() => ({
  open: vi.fn(), save: vi.fn(), copy: vi.fn(), draft: vi.fn(), invoke: vi.fn(),
  currentPath: null as string | null,
  close: undefined as (() => void) | undefined,
  editors: [] as TiptapEditor[],
}))
vi.mock('./lib/documentBackend', () => ({
  documentBackend: {
    open: fixture.open, openAtPath: fixture.open, create: fixture.open,
    save: fixture.save, createRecoveryCopy: fixture.copy,
    persistDraft: fixture.draft,
    readLatestDraft: vi.fn(async () => null),
    getOpenPath: () => fixture.currentPath,
    hasOpenDocument: () => fixture.currentPath !== null,
    getSessionId: () => 'synthetic-test',
  },
  copyText: vi.fn(), openExternalUrl: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: fixture.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event, handler) => { fixture.close = handler; return () => { fixture.close = undefined } }),
}))
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => undefined }) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ scaleFactor: async () => 1 }) }))
vi.mock('./components/EditorToolbar', () => ({ default: ({ editor }: { editor: TiptapEditor | null }) => {
  if (editor && !fixture.editors.includes(editor)) fixture.editors.push(editor)
  return null
} }))
import App from './App'
import { insertJournalDiagram } from './components/JournalDiagramNode'

let root: Root
let container: HTMLDivElement
const date = '2026-10-25 Sunday'
function revision(name: string): JournalRevision {
  const editorHtml = `<h2>${date}</h2><p>${name}</p>`
  return { editorHtml, fullHtml: `<html><body>${editorHtml}</body></html>`, path: `/synthetic/${name}.html`, displayName: name, revision: name, modifiedAt: 1, conflictCount: 0 }
}
function activeEditors() { return fixture.editors.filter(editor => !editor.isDestroyed) }
async function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === label)
  expect(button, `button ${label}`).toBeDefined()
  await act(async () => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}
async function open(name: string) {
  fixture.open.mockImplementationOnce(async () => { fixture.currentPath = `/synthetic/${name}.html`; return revision(name) })
  await click('open file')
  await vi.waitFor(() => expect(activeEditors()).toHaveLength(1))
}

beforeEach(async () => {
  vi.clearAllMocks()
  // jsdom has no layout engine; these observers/rectangles are irrelevant to
  // save behaviour but are present in the real WebKit window.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  fixture.currentPath = null
  fixture.editors = []
  fixture.save.mockResolvedValue({ status: 'saved' })
  fixture.copy.mockResolvedValue('/synthetic/conflict.html')
  fixture.draft.mockResolvedValue('/synthetic/draft.html')
  fixture.invoke.mockResolvedValue(undefined)
  localStorage.clear()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<App />) })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('document and window lifecycle', () => {
  it('starts a new undo history when switching journals', async () => {
    await open('Journal A')
    const first = activeEditors()[0]
    await act(async () => { first.commands.insertContentAt(first.state.doc.content.size - 1, ' edited') })
    await open('Journal B')
    expect(first.isDestroyed).toBe(true)
    await act(async () => { activeEditors()[0].commands.undo() })
    expect(activeEditors()[0].getText()).toContain('Journal B')
    expect(activeEditors()[0].getText()).not.toContain('Journal A')
  })

  it.each(['Cmd+S', 'native close'])('%s flushes the Focus editor before its debounce runs', async action => {
    await open('Original')
    const main = activeEditors()[0]
    await act(async () => { main.commands.setTextSelection(main.state.doc.content.size - 1) })
    await click('focus')
    await vi.waitFor(() => expect(activeEditors()).toHaveLength(2))
    const focused = activeEditors()[1]
    await act(async () => {
      focused.commands.insertContentAt(focused.state.doc.content.size - 1, ' newest focus text')
      if (action === 'Cmd+S') window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))
      else fixture.close?.()
    })
    expect(fixture.save).toHaveBeenLastCalledWith(expect.stringContaining('newest focus text'))
  })

  it('keeps the hidden main document unchanged while Focus types and saves', async () => {
    await open('Original')
    const main = activeEditors()[0]
    await act(async () => { main.commands.setTextSelection(main.state.doc.content.size - 1) })
    await click('focus')
    await vi.waitFor(() => expect(activeEditors()).toHaveLength(2))
    const focused = activeEditors()[1]
    const originalDoc = main.state.doc
    expect(main.isEditable).toBe(false)
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString')
    try {
      await act(async () => {
        focused.view.dispatch(focused.state.tr.insertText(' continuous focus typing', focused.state.doc.content.size - 1))
        await new Promise(resolve => setTimeout(resolve, 300))
      })
      expect(main.state.doc).toBe(originalDoc)
      expect(parse).not.toHaveBeenCalled()
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true })))
      expect(fixture.save).toHaveBeenLastCalledWith(expect.stringContaining('continuous focus typing'))
      expect(main.state.doc).toBe(originalDoc)
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
      expect(main.getText()).toContain('continuous focus typing')
      expect(main.isEditable).toBe(true)
    } finally { parse.mockRestore() }
  })

  it('updates main-editor counts without parsing the whole journal while typing', async () => {
    await open('Original')
    const main = activeEditors()[0]
    const unchangedHeading = main.state.doc.child(0)
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString')
    try {
      await act(async () => {
        main.view.dispatch(main.state.tr.insertText(' more writing', main.state.doc.content.size - 1))
        await new Promise(resolve => setTimeout(resolve, 300))
      })
      expect(parse).not.toHaveBeenCalled()
      expect(main.state.doc.child(0)).toBe(unchangedHeading)
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true })))
      expect(fixture.save).toHaveBeenLastCalledWith(expect.stringContaining('more writing'))
    } finally { parse.mockRestore() }
  })

  it.each(['Cmd+S', 'native close'])('%s includes the latest diagram edit from Focus', async action => {
    await open('Original')
    const main = activeEditors()[0]
    await act(async () => { main.commands.setTextSelection(main.state.doc.content.size - 1) })
    await click('focus')
    await vi.waitFor(() => expect(activeEditors()).toHaveLength(2))
    const focused = activeEditors()[1]
    await act(async () => { insertJournalDiagram(focused) })
    await vi.waitFor(() => expect(document.querySelector('.diagram-window')).not.toBeNull())
    const starter = Array.from(document.querySelectorAll('.diagram-window button')).find(button => button.textContent === 'six-month timeline')!
    await act(async () => starter.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const title = document.querySelector<HTMLInputElement>('[aria-label="Diagram title"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, 'Newest six-month plan')
      title.dispatchEvent(new Event('input', { bubbles: true }))
      if (action === 'Cmd+S') window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
      else fixture.close?.()
    })
    const saved = fixture.save.mock.lastCall![0] as string
    const parsed = new DOMParser().parseFromString(saved, 'text/html')
    const data = JSON.parse(parsed.querySelector('figure')!.getAttribute('data-journal-diagram')!)
    expect(data.title).toBe('Newest six-month plan')
    expect(data.nodes).toHaveLength(6)
    expect(data.edges).toHaveLength(5)
    expect(saved).toContain(date)
    expect(main.state.doc.toJSON()).not.toEqual(focused.state.doc.toJSON())
    if (action === 'Cmd+S') {
      await act(async () => title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(document.querySelector('.diagram-window')).toBeNull()
      expect(document.querySelector('.focus-window')).not.toBeNull()
    }
  })

  it('protects an open diagram after a save conflict while retaining its newest source', async () => {
    await open('Original')
    await act(async () => { insertJournalDiagram(activeEditors()[0]) })
    await vi.waitFor(() => expect(document.querySelector('.diagram-window')).not.toBeNull())
    fixture.save.mockResolvedValueOnce({ status: 'remoteChanged', report: 'Synthetic conflict' })
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true })))
    expect(document.querySelector<HTMLInputElement>('[aria-label="Diagram title"]')!.disabled).toBe(true)
    expect(fixture.copy).toHaveBeenLastCalledWith('conflict', expect.stringContaining('data-journal-diagram'))
  })

  it('native closing waits for the newest editor text to finish saving', async () => {
    await open('Original')
    let finish!: (result: SaveResult) => void
    fixture.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await act(async () => {
      const editor = activeEditors()[0]
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' final characters')
      fixture.close?.()
    })
    expect(fixture.save).toHaveBeenLastCalledWith(expect.stringContaining('final characters'))
    expect(fixture.invoke).not.toHaveBeenCalledWith('finish_journal_close')
    await act(async () => { finish({ status: 'saved' }) })
    expect(fixture.invoke).toHaveBeenCalledWith('finish_journal_close')
  })

  it('preserves visible typing that has not reached the queue when a conflict arrives', async () => {
    await open('Original')
    let finish!: (result: SaveResult) => void
    fixture.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
    })
    await act(async () => {
      const editor = activeEditors()[0]
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' not yet queued')
      finish({ status: 'remoteChanged', report: 'Synthetic external change' })
    })
    expect(fixture.draft).toHaveBeenLastCalledWith(expect.stringContaining('not yet queued'))
    expect(fixture.copy).toHaveBeenLastCalledWith('conflict', expect.stringContaining('not yet queued'))
    expect(activeEditors()[0].isEditable).toBe(false)
  })

  it('shows a recovery warning even after a successful main save', async () => {
    await open('Original')
    fixture.save.mockResolvedValueOnce({ status: 'saved', warning: 'Synthetic recovery folder unavailable' })
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
    })
    expect(container.textContent).toContain('Synthetic recovery folder unavailable')
    expect(container.textContent).toContain('copy error report')
  })

  it('shows a quit-time backup warning once and still allows closing a saved journal', async () => {
    await open('Original')
    fixture.save.mockResolvedValue({ status: 'saved', warning: 'Synthetic backup unavailable' })
    await act(async () => { fixture.close?.() })
    expect(fixture.invoke).not.toHaveBeenCalledWith('finish_journal_close')
    expect(container.textContent).toContain('The journal itself was saved')
    await act(async () => { fixture.close?.() })
    expect(fixture.invoke).toHaveBeenCalledWith('finish_journal_close')
  })

  it('keeps the app open with a copyable report when saving fails', async () => {
    await open('Original')
    fixture.save.mockResolvedValueOnce({ status: 'failed', report: 'Synthetic disk unavailable' })
    await act(async () => { fixture.close?.() })
    expect(fixture.invoke).not.toHaveBeenCalledWith('finish_journal_close')
    expect(container.textContent).toContain('Synthetic disk unavailable')
    expect(container.textContent).toContain('copy error report')
    expect(fixture.copy).toHaveBeenCalledWith('conflict', expect.stringContaining('Original'))
  })
})
