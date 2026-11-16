import { Editor, useEditorState } from '@tiptap/react'
import { insertJournalDiagram } from './JournalDiagramNode'

type Props = {
  editor: Editor | null
  editable?: boolean
}

export default function EditorToolbar({ editor, editable = true }: Props) {
  // Subscribe only to formatting changes. Moving the caret or typing plain
  // text does not need to redraw the editor and its surrounding controls.
  const active = useEditorState({ editor, selector: ({ editor: current }) => current ? {
    h1: current.isActive('heading', { level: 1 }),
    h2: current.isActive('heading', { level: 2 }),
    h3: current.isActive('heading', { level: 3 }),
    bold: current.isActive('bold'), italic: current.isActive('italic'),
    underline: current.isActive('underline'), bulletList: current.isActive('bulletList'),
    orderedList: current.isActive('orderedList'), blockquote: current.isActive('blockquote'),
    code: current.isActive('code'),
  } : null })
  if (!editor || !active) return null

  const btn = (label: string, onClick: () => void, active: boolean, title?: string) => (
    <button
      type="button"
      className={`fmt-btn${active ? ' fmt-btn-active' : ''}`}
      disabled={!editable}
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      title={title}
      aria-pressed={active}
    >
      {label}
    </button>
  )

  return (
    <div className="fmt-toolbar">
      {btn('H1', () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        active.h1, 'Heading 1')}
      {btn('H2', () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        active.h2, 'Heading 2')}
      {btn('H3', () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        active.h3, 'Heading 3')}
      <span className="fmt-sep" />
      {btn('B', () => editor.chain().focus().toggleBold().run(),
        active.bold, 'Bold (⌘B)')}
      {btn('I', () => editor.chain().focus().toggleItalic().run(),
        active.italic, 'Italic (⌘I)')}
      {btn('U', () => editor.chain().focus().toggleUnderline().run(),
        active.underline, 'Underline (⌘U)')}
      <span className="fmt-sep" />
      {btn('• List', () => editor.chain().focus().toggleBulletList().run(),
        active.bulletList, 'Bullet list')}
      {btn('1. List', () => editor.chain().focus().toggleOrderedList().run(),
        active.orderedList, 'Numbered list')}
      <span className="fmt-sep" />
      {btn('Quote', () => editor.chain().focus().toggleBlockquote().run(),
        active.blockquote, 'Blockquote')}
      {btn('Code', () => editor.chain().focus().toggleCode().run(),
        active.code, 'Inline code')}
      <span className="fmt-sep" />
      <button type="button" className="fmt-btn" disabled={!editable}
        onMouseDown={event => event.preventDefault()}
        onClick={() => insertJournalDiagram(editor)} title="Insert an editable flowchart or timeline">
        + diagram
      </button>
    </div>
  )
}
