import { useEffect, useLayoutEffect, useRef } from 'react'
import { useEditor, EditorContent, Editor as TiptapEditor } from '@tiptap/react'
import { Extension, InputRule } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import EditorToolbar from './EditorToolbar'
import { centreCursorInScroller } from '../lib/typewriter'

type Props = {
  value: string
  onChange: (value: string) => void
  typewriterMode: boolean
  scrollToDate: Date | null
  onScrollToDateDone: () => void
  onBridgeReady?: (bridge: EditorBridge | null) => void
}

export type EditorBridge = {
  getLatestMarkdown: () => string
}

const CHANGE_SYNC_DELAY = 250
const WRAPPING_PAIRS: Record<string, [string, string]> = {
  '"': ['"', '"'],
  "'": ["'", "'"],
  '(': ['(', ')'],
  ')': ['(', ')'],
  '[': ['[', ']'],
  ']': ['[', ']'],
  '{': ['{', '}'],
  '}': ['{', '}'],
}

const EmDashShortcut = Extension.create({
  name: 'emDashShortcut',

  addInputRules() {
    return [
      // This keeps the writing flow light by turning two hyphens into a proper
      // em dash at the moment the second hyphen is typed.
      new InputRule({
        find: /--$/,
        handler: ({ state, range, chain }) => {
          const { $from } = state.selection

          // Skip the replacement inside code blocks so literal `--` stays
          // available when the user actually needs those characters.
          if ($from.parent.type.spec.code) return

          chain()
            .deleteRange(range)
            .insertContent('—')
            .run()
        },
      }),
    ]
  },
})

function isoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function collapseClipboardWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function flattenParagraphsInsideListItems(container: HTMLElement) {
  container.querySelectorAll('li > p').forEach((paragraph) => {
    const listItem = paragraph.parentElement
    if (!listItem) return

    // Some receiving apps add paragraph margins inside every list item. Moving
    // the paragraph contents directly into the <li> keeps copied lists compact.
    while (paragraph.firstChild) {
      listItem.insertBefore(paragraph.firstChild, paragraph)
    }

    paragraph.remove()
  })
}

function stripEditorOnlyAttributes(container: HTMLElement) {
  container.querySelectorAll('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if (element.tagName.toLowerCase() === 'a' && attribute.name === 'href') return
      element.removeAttribute(attribute.name)
    })
  })
}

function getListItemText(listItem: HTMLElement, prefix: string, depth: number): string {
  const clone = listItem.cloneNode(true) as HTMLElement
  clone.querySelectorAll('ul, ol').forEach((nestedList) => nestedList.remove())

  const text = collapseClipboardWhitespace(clone.textContent ?? '')
  const nestedLists = Array.from(listItem.children).filter(
    (child): child is HTMLElement => child.tagName === 'UL' || child.tagName === 'OL',
  )
  const nestedText = nestedLists
    .map((list) => getListText(list, depth + 1))
    .filter(Boolean)
    .join('\n')

  const line = `${'  '.repeat(depth)}${prefix}${text}`.trimEnd()
  return nestedText ? `${line}\n${nestedText}` : line
}

function getListText(list: HTMLElement, depth = 0): string {
  const isOrdered = list.tagName === 'OL'
  const start = Number(list.getAttribute('start') ?? '1') || 1

  return Array.from(list.children)
    .filter((child): child is HTMLElement => child.tagName === 'LI')
    .map((listItem, index) => {
      const prefix = isOrdered ? `${start + index}. ` : '- '
      return getListItemText(listItem, prefix, depth)
    })
    .join('\n')
}

function getCleanPlainTextFromHtml(html: string): string {
  const container = document.createElement('div')
  container.innerHTML = html

  return Array.from(container.children)
    .map((child) => {
      if (!(child instanceof HTMLElement)) return ''
      if (child.tagName === 'UL' || child.tagName === 'OL') return getListText(child)
      if (child.tagName === 'HR') return '---'
      return collapseClipboardWhitespace(child.textContent ?? '')
    })
    .filter(Boolean)
    .join('\n\n')
}

function writeCleanSelectionToClipboard(view: EditorView, event: ClipboardEvent): boolean {
  if (!event.clipboardData || view.state.selection.empty) return false

  const selection = view.state.selection.content()
  const fragment = DOMSerializer
    .fromSchema(view.state.schema)
    .serializeFragment(selection.content)
  const container = document.createElement('div')
  container.appendChild(fragment)

  flattenParagraphsInsideListItems(container)
  stripEditorOnlyAttributes(container)

  const cleanHtml = container.innerHTML
  const cleanPlainText = getCleanPlainTextFromHtml(cleanHtml)

  event.clipboardData.setData('text/html', cleanHtml)
  event.clipboardData.setData('text/plain', cleanPlainText)
  event.preventDefault()
  return true
}

export default function Editor({
  value,
  onChange,
  typewriterMode,
  scrollToDate,
  onScrollToDateDone,
  onBridgeReady,
}: Props) {
  const lastValueRef = useRef(value)
  const lastSyncedMarkdownRef = useRef(value)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const typewriterRef = useRef(typewriterMode)
  const previousTypewriterModeRef = useRef(typewriterMode)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  typewriterRef.current = typewriterMode

  function moveCursorToDocumentEnd() {
    if (!editor) return

    const docEnd = Math.max(0, editor.state.doc.content.size)
    editor.commands.focus()
    editor.commands.setTextSelection(docEnd)
  }

  function moveCursorNearClick(clientX: number, clientY: number) {
    if (!editor) return

    const contentElement = contentRef.current
    const proseMirrorElement = editor.view.dom as HTMLElement

    if (!contentElement || !proseMirrorElement) {
      moveCursorToDocumentEnd()
      return
    }

    const contentRect = contentElement.getBoundingClientRect()
    const proseMirrorRect = proseMirrorElement.getBoundingClientRect()
    const clickedRightGutter = clientX > proseMirrorRect.right

    // If the click lands above the current text block, aim just inside the
    // writable area. If it lands beside the text, clamp into the text column so
    // ProseMirror can resolve the nearest caret position on that visual line.
    const clampedLeft = Math.max(
      proseMirrorRect.left + 4,
      Math.min(clientX, proseMirrorRect.right - 4),
    )
    const clampedTop = Math.max(
      proseMirrorRect.top + 4,
      Math.min(clientY, Math.max(proseMirrorRect.bottom - 4, contentRect.top + 4)),
    )

    const position = editor.view.posAtCoords({
      left: clampedLeft,
      top: clampedTop,
    })

    if (!position) {
      moveCursorToDocumentEnd()
      return
    }

    // Clicking in the right gutter tends to resolve to the start of the next
    // visual line. Nudging one position back lands the caret at the end of the
    // intended line instead.
    const resolvedPos = clickedRightGutter
      ? Math.max(0, position.pos - 1)
      : position.pos

    editor.commands.focus()
    editor.commands.setTextSelection(resolvedPos)
  }

  function getHtmlFromEditorInstance(editor: TiptapEditor): string {
    return editor.getHTML()
  }

  function flushEditorSync(editor: TiptapEditor) {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current)
      syncTimerRef.current = null
    }

    const nextHtml = getHtmlFromEditorInstance(editor)
    lastValueRef.current = nextHtml

    if (nextHtml !== lastSyncedMarkdownRef.current) {
      lastSyncedMarkdownRef.current = nextHtml
      onChange(nextHtml)
    }
  }

  function wrapCurrentSelection(editor: TiptapEditor, open: string, close: string): boolean {
    const { state, view } = editor
    const { from, to, empty } = state.selection

    if (empty) return false

    // We insert around the selection instead of replacing it, which recreates
    // the convenient Obsidian behavior for quotes and bracket pairs.
    const transaction = state.tr
      .insertText(close, to, to)
      .insertText(open, from, from)

    transaction.setSelection(TextSelection.create(transaction.doc, from + 1, to + 1))
    view.dispatch(transaction)
    return true
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      EmDashShortcut,
    ],
    editorProps: {
      attributes: {
        // Disable browser and OS writing assistance so the journal behaves
        // like a plain writing surface instead of offering inline completions.
        spellcheck: 'false',
        autocomplete: 'off',
        autocorrect: 'off',
        autocapitalize: 'off',
        // Safari/WebKit uses this attribute for the newer inline writing
        // suggestions that can still appear even when the older attributes
        // are switched off.
        writingsuggestions: 'false',
        'data-gramm': 'false',
        'data-gramm_editor': 'false',
        'data-enable-grammarly': 'false',
      },
      handleKeyDown: (_view, event) => {
        if (!editor || event.metaKey || event.ctrlKey || event.altKey) {
          return false
        }

        const pair = WRAPPING_PAIRS[event.key]
        if (!pair) return false

        const [open, close] = pair
        const wrapped = wrapCurrentSelection(editor, open, close)

        if (wrapped) {
          event.preventDefault()
          return true
        }

        return false
      },
      handleDOMEvents: {
        copy: (view, event) => writeCleanSelectionToClipboard(view, event),
      },
    },
    content: value,
    onUpdate: ({ editor }) => {
      // In typewriter mode, only re-centre after the document actually changes.
      // This avoids the jumpy feeling when the user clicks, drags, or highlights
      // text somewhere else in the editor.
      if (typewriterRef.current && scrollerRef.current) {
        centreCursorInScroller(editor as TiptapEditor, scrollerRef.current)
      }

      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      syncTimerRef.current = setTimeout(() => {
        flushEditorSync(editor as TiptapEditor)
      }, CHANGE_SYNC_DELAY)
    },
    onBlur: ({ editor }) => {
      flushEditorSync(editor as TiptapEditor)
    },
  })

  useEffect(() => {
    if (!onBridgeReady) return
    if (!editor) {
      onBridgeReady(null)
      return
    }

    onBridgeReady({
      getLatestMarkdown: () => {
        flushEditorSync(editor)
        return lastValueRef.current
      },
    })

    return () => onBridgeReady(null)
  }, [editor, onBridgeReady])

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    }
  }, [])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const previousMode = previousTypewriterModeRef.current

    if (!scroller || previousMode === typewriterMode) return

    // Typewriter mode adds large top/bottom margins so the caret can be kept
    // around the middle of the screen while typing. When the mode is toggled,
    // we offset the scroll position by the same amount so the current view does
    // not suddenly jump before the user starts typing again.
    const offset = scroller.clientHeight * 0.5
    const maxScroll = scroller.scrollHeight - scroller.clientHeight
    const nextScrollTop = typewriterMode
      ? scroller.scrollTop + offset
      : scroller.scrollTop - offset

    scroller.scrollTop = Math.max(0, Math.min(nextScrollTop, maxScroll))
    previousTypewriterModeRef.current = typewriterMode
  }, [typewriterMode])

  // External value changes (file open / new day)
  useEffect(() => {
    if (!editor) return
    if (value !== lastValueRef.current) {
      lastValueRef.current = value
      lastSyncedMarkdownRef.current = value
      editor.commands.setContent(value, { emitUpdate: false })
    }
  }, [value, editor])

  // Scroll to the end of today's section (or jumped-to date) so the cursor
  // is ready to type.  We pick the LAST heading matching the date, then walk
  // forward to the next heading / horizontal rule (or end of doc) and place
  // the cursor just before it.
  useEffect(() => {
    if (!editor || !scrollToDate) return
    const target = isoDate(scrollToDate)
    let headingPos = -1
    let sectionEnd = -1
    editor.state.doc.descendants((node, pos) => {
      if (headingPos === -1) {
        if (node.type.name === 'heading' && node.textContent.includes(target)) {
          headingPos = pos
        }
      } else if (sectionEnd === -1) {
        if (node.type.name === 'heading' || node.type.name === 'horizontalRule') {
          if (pos > headingPos) sectionEnd = pos
        }
      }
      return true
    })
    if (headingPos < 0) {
      onScrollToDateDone()
      return
    }
    if (sectionEnd === -1) sectionEnd = editor.state.doc.content.size
    const cursorPos = Math.max(headingPos + 1, sectionEnd - 1)

    const frame = requestAnimationFrame(() => {
      const sc = scrollerRef.current
      if (!sc) { onScrollToDateDone(); return }
      editor.commands.setTextSelection(cursorPos)
      editor.commands.focus()
      try {
        const coords = editor.view.coordsAtPos(cursorPos)
        const scRect = sc.getBoundingClientRect()
        const cursorAbsTop = coords.top - scRect.top + sc.scrollTop
        // Place cursor about 60% down from the top so there's room above for
        // context and room below for typing.
        const desired = cursorAbsTop - sc.clientHeight * 0.6
        sc.scrollTop = Math.max(0, Math.min(desired, sc.scrollHeight - sc.clientHeight))
      } catch {}
      onScrollToDateDone()
    })
    return () => cancelAnimationFrame(frame)
  }, [scrollToDate, editor, onScrollToDateDone])

  return (
    <div className="editor-wrap">
      <EditorToolbar editor={editor} />
      <div
        ref={scrollerRef}
        className={`editor-scroll${typewriterMode ? ' typewriter' : ''}`}
        onMouseDown={(event) => {
          const target = event.target as HTMLElement

          // If the user clicks the empty gutter around the text column, place
          // the caret on the nearest visual line instead of forcing it to the
          // document end. This keeps the wide margins usable as click targets.
          if (!target.closest('.ProseMirror')) {
            event.preventDefault()
            moveCursorNearClick(event.clientX, event.clientY)
          }
        }}
      >
        <div ref={contentRef} className="editor-content">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
