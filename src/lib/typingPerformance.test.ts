// @vitest-environment jsdom
import { it, expect } from 'vitest'
import { EditorSnapshotCache, createFocusSession, summarizeBlocks } from './editorSnapshot'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { extractEntries, getCurrentDaySection, getYearEntryText, replaceEntryBodyHtml } from './journal'
it.skipIf(!import.meta.env.VITE_JOURNAL_BENCHMARK)('compares previous and incremental typing pipelines with synthetic text', () => {
  const html = Array.from({length: 1000}, (_, i) => `<h2>${new Date(2024, 0, i + 1).toISOString().slice(0,10)}</h2>` + `<p>${'Synthetic journal words for performance measurement. '.repeat(12)}</p>`.repeat(8)).join('')
  const editor = new Editor({extensions: [StarterKit], content: html})
  const measure = (label: string, work: () => unknown) => { const start = performance.now(); work(); console.log(label, (performance.now() - start).toFixed(1), 'ms') }
  console.log('Synthetic document', html.length, 'bytes')
  measure('Full HTML serialization', () => editor.getHTML())
  measure('Three statistics parses', () => { extractEntries(html); getCurrentDaySection(html,new Date()); getYearEntryText(html,2026) })
  measure('Focus merge and hidden editor replacement', () => editor.commands.setContent(replaceEntryBodyHtml(html,new Date(2026,0,1),'<p>Edited focus text</p>'),{emitUpdate:false}))
  const cache = new EditorSnapshotCache()
  const snapshot = cache.read(editor.state.doc)
  editor.view.dispatch(editor.state.tr.insertText(' latest words', editor.state.doc.content.size - 1))
  measure('Incremental HTML and statistics', () => cache.read(editor.state.doc))
  expect(cache.read(editor.state.doc).html).toBe(editor.getHTML())
  const session = createFocusSession(snapshot, new Date(2026,0,1))!
  const focus = new Editor({ extensions: [StarterKit], content: session.initialHtml })
  const focusCache = new EditorSnapshotCache()
  focusCache.read(focus.state.doc)
  focus.view.dispatch(focus.state.tr.insertText(' latest focus words', focus.state.doc.content.size - 1))
  measure('Incremental Focus HTML, merge, and statistics', () => {
    const changed = focusCache.read(focus.state.doc)
    summarizeBlocks([...session.before, ...changed.blocks, ...session.after])
  })
  focus.destroy()
  editor.destroy()
}, 60000)
