// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { JournalDiagramNode } from '../components/JournalDiagramNode'
import { EditorSnapshotCache } from './editorSnapshot'
import { diagramSvg, edgeGeometry, parseDiagram, removeDiagramNode, starterDiagram } from './diagram'

const editors: Editor[] = []
function create(content: string | object) {
  const editor = new Editor({ extensions: [StarterKit, JournalDiagramNode], content })
  editors.push(editor)
  return editor
}
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()))

describe('portable journal diagrams', () => {
  it('round-trips editable source, notes, arrows and preview through journal HTML', () => {
    const data = starterDiagram('timeline', new Date(2026, 9, 26))
    data.title = 'Six months <ideas> & "plans"'
    data.nodes[0].notes = 'A note with\nmultiple lines and <tags>.'
    data.edges.push({ id: 'feedback', from: data.nodes[5].id, to: data.nodes[0].id, label: 'Review & repeat', route: 'above' })
    const editor = create({ type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '2026-10-26 Monday' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'My written entry' }] },
      { type: 'journalDiagram', attrs: { id: 'test-diagram', data: JSON.stringify(data) } },
      { type: 'paragraph', content: [{ type: 'text', text: 'Writing after diagram' }] },
    ] })
    const html = editor.getHTML()
    expect(html).toContain('data:image/svg+xml')
    expect(html).toContain('<figcaption>Six months &lt;ideas&gt; &amp; "plans"</figcaption>')
    const reopened = create(html)
    expect(parseDiagram(reopened.state.doc.child(2).attrs.data)).toEqual(data)
    expect(reopened.getText()).toContain('Writing after diagram')
    const snapshot = new EditorSnapshotCache().read(reopened.state.doc, new Date(2026, 9, 26))
    expect(snapshot.todayWords).toBe(6)
    expect(snapshot.html).toBe(reopened.getHTML())
  })

  it('keeps unreadable or newer diagram data instead of silently discarding it', () => {
    const raw = '{"version":999,"unknown":"keep this exactly"}'
    const editor = create({ type: 'doc', content: [{ type: 'journalDiagram', attrs: { id: 'future', data: raw } }] })
    const reopened = create(editor.getHTML())
    expect(reopened.state.doc.firstChild?.attrs.data).toBe(raw)
    expect(reopened.getHTML()).toContain('Original data retained')
  })

  it('accepts feedback cycles but rejects broken IDs, coordinates and versions', () => {
    const data = starterDiagram('flow')
    data.edges.push({ id: 'loop', from: data.nodes[2].id, to: data.nodes[0].id, label: 'again', route: 'below' })
    expect(parseDiagram(JSON.stringify(data))).toEqual(data)
    expect(parseDiagram(JSON.stringify({ ...data, version: 2 }))).toBeNull()
    expect(parseDiagram(JSON.stringify({ ...data, title: '\ud800' }))).toBeNull()
    expect(parseDiagram(JSON.stringify({ ...data, nodes: [...data.nodes, data.nodes[0]] }))).toBeNull()
    expect(parseDiagram(JSON.stringify({ ...data, nodes: [{ ...data.nodes[0], x: null }] }))).toBeNull()
    expect(parseDiagram(JSON.stringify({ ...data, edges: [{ ...data.edges[0], to: 'missing' }] }))).toBeNull()
  })

  it('removes a deleted step and its connections together', () => {
    const data = starterDiagram('flow')
    const changed = removeDiagramNode(data, data.nodes[1].id)
    expect(changed.nodes).toHaveLength(2)
    expect(changed.edges).toHaveLength(0)
    expect(data.nodes).toHaveLength(3)
  })

  it('makes consecutive timeline months across a year boundary', () => {
    const data = starterDiagram('timeline', new Date(2026, 10, 30))
    expect(data.nodes.map(node => node.date)).toEqual(['Nov 2026', 'Dec 2026', 'Jan 2027', 'Feb 2027', 'Mar 2027', 'Apr 2027'])
    expect(data.edges).toHaveLength(5)
  })

  it('renders text as inert SVG text, including notes and connector labels', () => {
    const data = starterDiagram('flow')
    data.title = '<script>alert("no")</script>'
    data.nodes[0].text = '<image onload="bad">'
    data.nodes[0].notes = '</text><script>bad</script>'
    data.edges[0].label = '<script>bad</script>'
    const svg = diagramSvg(data)
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
    expect(parsed.querySelector('parsererror')).toBeNull()
    expect(parsed.querySelector('script,image')).toBeNull()
    expect(parsed.querySelector('title')?.textContent).toBe(data.title)
    expect(svg).toContain('&lt;script&gt;')
    expect(edgeGeometry(data.nodes[0], data.nodes[0], 'auto').path).not.toContain('NaN')
  })
})
