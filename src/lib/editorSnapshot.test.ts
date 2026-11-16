// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor, Extension, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { DOMSerializer } from '@tiptap/pm/model'
import { createFocusSession, EditorSnapshotCache, summarizeBlocks } from './editorSnapshot'

const editors: Editor[] = []
function makeEditor(content: string) {
  const editor = new Editor({
    extensions: [StarterKit,
      Extension.create({ name: 'reminders', addGlobalAttributes: () => [{ types: ['heading'], attributes: {
        dailyReminders: { default: null, parseHTML: element => element.getAttribute('data-daily-reminders'),
          renderHTML: attributes => attributes.dailyReminders ? { 'data-daily-reminders': attributes.dailyReminders } : {} },
      } }] }),
      Node.create({ name: 'image', group: 'block', atom: true,
        addAttributes: () => ({ src: { default: null } }), parseHTML: () => [{ tag: 'img' }],
        renderHTML: ({ HTMLAttributes }) => ['img', HTMLAttributes],
      }),
    ], content,
  })
  editors.push(editor)
  return editor
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks() })

describe('incremental journal snapshots', () => {
  it('preserves formatting, images, lists, and heading attributes exactly', () => {
    const editor = makeEditor('<h2 data-daily-reminders="[]">2026-10-26 Monday</h2><p><strong>Bold</strong> <em>italic</em> <a href="https://example.com">link</a><br>next line</p><ul><li><p>First</p><ul><li><p>Nested</p></li></ul></li></ul><img src="data:image/png;base64,abcd"><hr><pre><code>literal &lt;code&gt;</code></pre>')
    expect(new EditorSnapshotCache().read(editor.state.doc).html).toBe(editor.getHTML())
  })

  it('converts only the changed block and reuses cached blocks after Undo', () => {
    const editor = makeEditor('<h2>2026-10-26 Monday</h2>' + '<p>unchanged paragraph</p>'.repeat(300))
    const cache = new EditorSnapshotCache()
    const original = cache.read(editor.state.doc)
    const serialize = vi.spyOn(DOMSerializer.prototype, 'serializeNode')
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' new words')
    const changed = cache.read(editor.state.doc)
    expect(serialize).toHaveBeenCalledTimes(1)
    expect(changed.blocks[1]).toBe(original.blocks[1])
    expect(changed.html).toBe(editor.getHTML())
    serialize.mockClear()
    expect(cache.read(editor.state.doc)).toBe(changed)
    expect(serialize).not.toHaveBeenCalled()
    editor.commands.undo()
    expect(cache.read(editor.state.doc).html).toBe(original.html)
  })

  it('counts body words under dated H2s, including ordinary subheadings and list items', () => {
    const editor = makeEditor('<p>Unassigned preface</p><h2>2025-12-31 Wednesday</h2><p>Old year</p><h2 data-daily-reminders="[]">261026 - Monday</h2><p>Today has words</p><h2>Ordinary subheading</h2><ul><li><p>One</p></li><li><p>Two</p></li></ul><h2>2026-10-27 Tuesday</h2><p>Following entry</p>')
    const snapshot = new EditorSnapshotCache().read(editor.state.doc, new Date(2026, 9, 26))
    expect(snapshot.entries).toHaveLength(3)
    expect(snapshot.todayWords).toBe(7)
    expect(snapshot.yearWords).toBe(9)
  })

  it('composes Focus changes without reparsing or changing neighbouring entries', () => {
    const editor = makeEditor('<h2>2026-10-25 Sunday</h2><p>Previous entry</p><h2 data-daily-reminders="[]">2026-10-26 Monday</h2><p>Original</p><h3>Subheading</h3><hr><h2>2026-10-27 Tuesday</h2><p>Next entry</p>')
    const snapshot = new EditorSnapshotCache().read(editor.state.doc)
    const session = createFocusSession(snapshot, new Date(2026, 9, 26))!
    expect(session.initialHtml).toBe('<p>Original</p><h3>Subheading</h3><hr>')
    const focused = makeEditor('<p>Replacement <strong>words</strong></p>')
    const focusSnapshot = new EditorSnapshotCache().read(focused.state.doc)
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString')
    const combined = summarizeBlocks([...session.before, ...focusSnapshot.blocks, ...session.after], new Date(2026, 9, 26))
    expect(parse).not.toHaveBeenCalled()
    expect(combined.todayWords).toBe(2)
    expect(combined.html).toBe(session.prefixHtml + focused.getHTML() + session.suffixHtml)
    expect(combined.blocks[0]).toBe(snapshot.blocks[0])
    expect(combined.blocks[combined.blocks.length - 1]).toBe(snapshot.blocks[snapshot.blocks.length - 1])
    expect(combined.html).toContain('data-daily-reminders="[]"')
    expect(createFocusSession(snapshot, new Date(1999, 0, 1))).toBeNull()
  })
})
