// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor, Extension, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { findEntryEnd, insertLoadedImage, pendingImagePlugin } from './editorSafety'

const editors: Editor[] = []
function makeEditor(content: string) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit,
      Node.create({ name: 'image', group: 'block', atom: true,
        addAttributes: () => ({ src: {}, alt: {} }),
        parseHTML: () => [{ tag: 'img' }], renderHTML: ({ HTMLAttributes }) => ['img', HTMLAttributes],
      }),
      Extension.create({ name: 'pendingImages', addProseMirrorPlugins: () => [pendingImagePlugin()] }),
    ], content,
  })
  editors.push(editor)
  return editor
}
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()))

describe('safe asynchronous image insertion', () => {
  it('maps a delayed insertion through intervening typing', async () => {
    const editor = makeEditor('<p>Original paragraph</p>')
    let complete!: (image: { src: string; name: string }) => void
    const loading = new Promise<{ src: string; name: string }>(resolve => { complete = resolve })
    const insertion = insertLoadedImage(editor.view, () => loading, 1)
    editor.commands.insertContentAt(1, 'New text ')
    complete({ src: 'data:image/png;base64,AA==', name: 'Synthetic image' })
    await insertion
    expect(editor.getText()).toContain('New text')
    expect(editor.getHTML()).toContain('<img')
  })

  it('cancels rather than throwing after the destination is replaced', async () => {
    const editor = makeEditor('<p>A long original journal paragraph with room for a drop</p>')
    let complete!: (image: { src: string; name: string }) => void
    const loading = new Promise<{ src: string; name: string }>(resolve => { complete = resolve })
    const insertion = insertLoadedImage(editor.view, () => loading, 30)
    editor.commands.setContent('<p>Short</p>')
    complete({ src: 'data:image/png;base64,AA==', name: 'Synthetic image' })
    await expect(insertion).resolves.toBeUndefined()
    expect(editor.getHTML()).toBe('<p>Short</p>')
  })

  it.each(['destroyed', 'protected'])('does not insert into a %s editor', async mode => {
    const editor = makeEditor('<p>Original</p>')
    let complete!: (image: { src: string; name: string }) => void
    const loading = new Promise<{ src: string; name: string }>(resolve => { complete = resolve })
    const insertion = insertLoadedImage(editor.view, () => loading)
    if (mode === 'destroyed') editor.destroy()
    else editor.setEditable(false)
    complete({ src: 'data:image/png;base64,AA==', name: 'Synthetic image' })
    await expect(insertion).resolves.toBeUndefined()
    if (mode === 'destroyed') expect(editor.isDestroyed).toBe(true)
    else expect(editor.getHTML()).not.toContain('<img')
  })
})

describe('library navigation', () => {
  it('finds compact dates and keeps ordinary subheadings inside the entry', () => {
    const editor = makeEditor('<h2>260417 - Friday</h2><p>Start</p><h3>Ordinary heading</h3><p>End</p><h2>2026-04-18 Saturday</h2><p>Next entry</p>')
    const position = findEntryEnd(editor.state.doc, new Date(2026, 3, 17))!
    expect(editor.state.doc.resolve(position).parent.textContent).toBe('End')
    expect(findEntryEnd(editor.state.doc, new Date(2026, 3, 19))).toBeNull()
  })
})
