import { useEffect, useMemo, useState } from 'react'
import { Node, Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { NodeViewWrapper, NodeViewProps, ReactNodeViewRenderer, useEditorState } from '@tiptap/react'
import DiagramEditor from './DiagramEditor'
import { diagramImage, emptyDiagram, JournalDiagram, newDiagramId, parseDiagram } from '../lib/diagram'

declare module '@tiptap/core' {
  interface Storage {
    journalDiagram: { openOnMount: string | null }
  }
}

type Options = { onError: (error: unknown) => void }

function DiagramCard({ node, editor, getPos, extension }: NodeViewProps) {
  const data = useMemo(() => parseDiagram(node.attrs.data), [node.attrs.data])
  const image = useMemo(() => data ? diagramImage(data) : null, [data])
  const [open, setOpen] = useState(() => {
    // Only a freshly inserted diagram opens automatically. This flag is local
    // to the editor, never saved in the HTML or replayed when opening a file.
    return editor.storage.journalDiagram.openOnMount === node.attrs.id && node.attrs.id !== null
  })
  useEffect(() => {
    if (open && editor.storage.journalDiagram.openOnMount === node.attrs.id) editor.storage.journalDiagram.openOnMount = null
  }, [editor, node.attrs.id, open])
  const editable = useEditorState({ editor, selector: ({ editor: current }) => current.isEditable })

  function update(next: JournalDiagram) {
    if (editor.isDestroyed || !editor.isEditable) return false
    const position = getPos()
    const current = typeof position === 'number' ? editor.state.doc.nodeAt(position) : null
    if (!current || current.type.name !== 'journalDiagram' || current.attrs.id !== node.attrs.id) return false
    // Dispatch immediately. Save/quit reads the normal document bridge and
    // cannot miss a final diagram keystroke waiting in a separate modal draft.
    editor.view.dispatch(editor.state.tr.setNodeMarkup(position!, undefined, { ...current.attrs, data: JSON.stringify(next) })
      .setMeta('journalDiagramEdit', true))
    return true
  }
  function remove() {
    if (editor.isDestroyed || !editor.isEditable) return
    const position = getPos()
    if (typeof position !== 'number') return
    const current = editor.state.doc.nodeAt(position)
    if (current?.type.name !== 'journalDiagram' || current.attrs.id !== node.attrs.id) return
    setOpen(false)
    editor.view.dispatch(closeHistory(editor.state.tr).delete(position, position + current.nodeSize).setMeta('journalDiagramEdit', true))
    editor.view.focus()
  }

  return <NodeViewWrapper className="journal-diagram-card" contentEditable={false}>
    <div className="journal-diagram-caption">
      <div><span className="diagram-kicker">diagram</span><strong>{data?.title || 'Untitled diagram'}</strong></div>
      {data ? <button type="button" className="diagram-button" disabled={!editable} onClick={() => setOpen(true)}>edit diagram</button>
        : <button type="button" className="diagram-button" onClick={() => extension.options.onError(new Error('This diagram uses unreadable or unsupported data. Its original saved data has been kept intact.'))}>diagram details</button>}
    </div>
    {image ? <button type="button" className="journal-diagram-preview" disabled={!editable} aria-label={`Edit diagram: ${data?.title || 'Untitled diagram'}`} onClick={() => setOpen(true)}>
      <img src={image} alt={data?.title || 'Journal diagram'} draggable={false} />
    </button> : <p className="journal-diagram-unavailable">Diagram preview unavailable. Original data retained.</p>}
    {open && data && <DiagramEditor initialData={data} editable={editable} onChange={update}
      onClose={() => {
        setOpen(false)
        if (!editor.isDestroyed) { editor.view.dispatch(closeHistory(editor.state.tr)); editor.view.focus() }
      }} onRemove={remove} />}
  </NodeViewWrapper>
}

export const JournalDiagramNode = Node.create<Options>({
  name: 'journalDiagram',
  priority: 1000,
  group: 'block',
  atom: true,
  draggable: true,
  addOptions() { return { onError: () => undefined } },
  addStorage() { return { openOnMount: null } },
  addAttributes() {
    return {
      id: { default: null, rendered: false, parseHTML: element => element.getAttribute('data-diagram-id') },
      data: { default: '', rendered: false, parseHTML: element => element.getAttribute('data-journal-diagram') ?? '' },
    }
  },
  parseHTML() { return [{ tag: 'figure[data-journal-diagram]' }] },
  renderHTML({ node }): DOMOutputSpec {
    const data = parseDiagram(node.attrs.data)
    // A standard figure + embedded SVG image remains readable in another HTML
    // viewer. The escaped data attribute retains the fully editable source.
    const content: DOMOutputSpec[] = data ? [
      ['img', { src: diagramImage(data), alt: data.title || 'Journal diagram', style: 'display:block;width:100%;height:auto;' }],
      ['figcaption', {}, data.title || 'Untitled diagram'],
    ] : [['figcaption', {}, 'Diagram unavailable. Original data retained.']]
    return ['figure', {
      'data-journal-diagram': node.attrs.data,
      'data-diagram-id': node.attrs.id,
      style: 'margin: 24px 0;',
    }, ...content]
  },
  addNodeView() { return ReactNodeViewRenderer(DiagramCard) },
})

export function insertJournalDiagram(editor: Editor): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false
  editor.view.dispatch(closeHistory(editor.state.tr))
  const id = newDiagramId()
  editor.storage.journalDiagram.openOnMount = id
  // Add a normal paragraph afterwards so writing can continue below the card.
  const inserted = editor.chain().focus().insertContent([
    { type: 'journalDiagram', attrs: { id, data: JSON.stringify(emptyDiagram()) } },
    { type: 'paragraph' },
  ]).run()
  if (!inserted) editor.storage.journalDiagram.openOnMount = null
  return inserted
}
