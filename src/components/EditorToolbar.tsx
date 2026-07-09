import { Editor } from '@tiptap/react'

type Props = {
  editor: Editor | null
}

export default function EditorToolbar({ editor }: Props) {
  if (!editor) return null

  const btn = (label: string, onClick: () => void, active: boolean, title?: string) => (
    <button
      type="button"
      className={`fmt-btn${active ? ' fmt-btn-active' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      title={title}
    >
      {label}
    </button>
  )

  return (
    <div className="fmt-toolbar">
      {btn('H1', () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        editor.isActive('heading', { level: 1 }), 'Heading 1')}
      {btn('H2', () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        editor.isActive('heading', { level: 2 }), 'Heading 2')}
      {btn('H3', () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        editor.isActive('heading', { level: 3 }), 'Heading 3')}
      <span className="fmt-sep" />
      {btn('B', () => editor.chain().focus().toggleBold().run(),
        editor.isActive('bold'), 'Bold (⌘B)')}
      {btn('I', () => editor.chain().focus().toggleItalic().run(),
        editor.isActive('italic'), 'Italic (⌘I)')}
      {btn('U', () => editor.chain().focus().toggleUnderline().run(),
        editor.isActive('underline'), 'Underline (⌘U)')}
      <span className="fmt-sep" />
      {btn('• List', () => editor.chain().focus().toggleBulletList().run(),
        editor.isActive('bulletList'), 'Bullet list')}
      {btn('1. List', () => editor.chain().focus().toggleOrderedList().run(),
        editor.isActive('orderedList'), 'Numbered list')}
      <span className="fmt-sep" />
      {btn('Quote', () => editor.chain().focus().toggleBlockquote().run(),
        editor.isActive('blockquote'), 'Blockquote')}
      {btn('Code', () => editor.chain().focus().toggleCode().run(),
        editor.isActive('code'), 'Inline code')}
    </div>
  )
}
