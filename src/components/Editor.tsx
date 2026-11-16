import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, Editor as TiptapEditor } from '@tiptap/react'
import { Extension, InputRule, Node, mergeAttributes } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { readFile } from '@tauri-apps/plugin-fs'
import DailyReminders, { DailyReminder } from './DailyReminders'
import EditorToolbar from './EditorToolbar'
import { JournalDiagramNode } from './JournalDiagramNode'
import { EditorSnapshotCache, EditorSnapshot } from '../lib/editorSnapshot'
import { findEntryEnd, insertLoadedImage, pendingImagePlugin } from '../lib/editorSafety'
import { createCursorCenterScheduler } from '../lib/typewriter'
import { parseHeadingDate } from '../lib/dates'
import { openExternalUrl } from '../lib/documentBackend'

type Props = {
  value: string
  onChange: (value: string, snapshot: EditorSnapshot) => void
  onSnapshot?: (snapshot: EditorSnapshot) => void
  suspended?: boolean
  onError?: (error: unknown) => void
  typewriterMode: boolean
  scrollToDate: Date | null
  onScrollToDateDone: () => void
  onActiveEntryDateChange?: (date: Date | null) => void
  autoFocus?: boolean
  variant?: 'standard' | 'focus'
  editable?: boolean
  onBridgeReady?: (bridge: EditorBridge | null) => void
}

export type EditorBridge = {
  runNativeCommand?: (command: string) => void
  getLatestHtml: () => string
  getSnapshot: () => EditorSnapshot
  insertImageDataUrl: (dataUrl: string, name: string) => void
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

// Reminder data belongs to the dated heading for its journal entry. TipTap
// keeps this small JSON string in a data attribute, so it is saved inside the
// same HTML file without placing reminder text in the writing column.
const DailyReminderHeadingData = Extension.create({
  name: 'dailyReminderHeadingData',

  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          dailyReminders: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-daily-reminders'),
            renderHTML: (attributes) => attributes.dailyReminders
              ? { 'data-daily-reminders': attributes.dailyReminders }
              : {},
          },
        },
      },
    ]
  },
})

// These two media nodes live in the journal HTML itself. Images are stored as
// data URLs, while YouTube clips use a preview card that opens the browser and
// still copy out as normal embed iframes.
const ImageNode = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' },
      title: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'img[src]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },
})

const YouTubeEmbed = Node.create({
  name: 'youtubeEmbed',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      videoId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-youtube-id') ?? getYouTubeVideoId(element.getAttribute('src') ?? ''),
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'div[data-youtube-id]' },
      { tag: 'iframe[src*="youtube"], iframe[src*="youtu.be"]' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const videoId = HTMLAttributes.videoId ?? getYouTubeVideoId(HTMLAttributes.src ?? '')
    const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : ''
    const thumbnailUrl = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : ''

    // YouTube rejects playback inside a macOS Tauri webview because the app
    // does not have a normal website referrer. A thumbnail card avoids showing
    // a broken Error 153 player; either play control opens the real video.
    return ['div', mergeAttributes({
      class: 'youtube-card',
      'data-youtube-id': videoId,
      contenteditable: 'false',
    }),
    ['img', {
      class: 'youtube-card-thumbnail',
      src: thumbnailUrl,
      alt: 'YouTube video thumbnail',
      draggable: 'false',
    }],
    ['button', {
      class: 'youtube-card-play',
      type: 'button',
      'data-youtube-url': watchUrl,
      'aria-label': 'Play video on YouTube',
    }, '▶'],
    ['div', { class: 'youtube-card-caption' },
      ['span', { class: 'youtube-card-label' }, 'YouTube video'],
      ['button', { type: 'button', 'data-youtube-url': watchUrl }, 'open on YouTube ↗'],
    ],
    ]
  },
})

function isoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseDailyReminders(value: unknown): DailyReminder[] {
  if (typeof value !== 'string' || value.length === 0) return []

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []

    // Validate each saved point before displaying it. This means a manually
    // edited or older journal file cannot break the entire reminders card.
    return parsed.flatMap((item): DailyReminder[] => {
      if (!item || typeof item !== 'object') return []
      const candidate = item as Partial<DailyReminder>
      if (typeof candidate.id !== 'string' || typeof candidate.text !== 'string') return []

      return [{
        id: candidate.id,
        text: candidate.text,
        done: candidate.done === true,
      }]
    })
  } catch {
    return []
  }
}

function getReminderHeadingPosition(editor: TiptapEditor, date: Date): number | null {
  let headingPosition: number | null = null

  editor.state.doc.descendants((node, position) => {
    if (headingPosition !== null || node.type.name !== 'heading') return headingPosition === null

    const headingDate = parseHeadingDate(node.textContent)
    if (headingDate && isoDate(headingDate) === isoDate(date)) {
      headingPosition = position
      return false
    }

    return true
  })

  return headingPosition
}

type ReminderRailState = {
  date: Date
  items: DailyReminder[]
  top: number
}

function getEntryDateAtCursor(editor: TiptapEditor): Date | null {
  const { doc, selection } = editor.state
  // Walk backwards from the caret and stop at its dated heading. Previously
  // every keystroke walked the entire journal from the first entry onwards.
  for (let index = Math.min(selection.$from.index(0), doc.childCount - 1); index >= 0; index--) {
    const node = doc.child(index)
    if (node.type.name !== 'heading' || node.attrs.level !== 2) continue
    const date = parseHeadingDate(node.textContent)
    if (date) return date
  }
  return null
}

function getYouTubeVideoId(value: string): string | null {
  try {
    const url = new URL(value.trim())
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    let videoId = ''

    if (host === 'youtu.be') videoId = url.pathname.slice(1).split('/')[0]
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      if (url.pathname === '/watch') videoId = url.searchParams.get('v') ?? ''
      else if (/^\/(embed|shorts|live)\//.test(url.pathname)) videoId = url.pathname.split('/')[2] ?? ''
    }

    // Only accept real-looking YouTube IDs, so ordinary links remain ordinary
    // pasted text rather than becoming an unexpected embedded card.
    return /^[A-Za-z0-9_-]{6,}$/.test(videoId) ? videoId : null
  } catch {
    return null
  }
}

function getYouTubeEmbedUrl(value: string): string | null {
  const videoId = getYouTubeVideoId(value)
  return videoId ? `https://www.youtube.com/embed/${videoId}` : null
}

function replaceYouTubeCardsForClipboard(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('[data-youtube-id]').forEach((card) => {
    const videoId = card.getAttribute('data-youtube-id')
    if (!videoId || !/^[A-Za-z0-9_-]{6,}$/.test(videoId)) return

    // The journal shows a safe preview card, while rich copy becomes a normal
    // YouTube iframe that publishing tools can embed in a web page.
    const iframe = document.createElement('iframe')
    iframe.setAttribute('src', `https://www.youtube.com/embed/${videoId}`)
    iframe.setAttribute('title', 'Embedded YouTube video')
    iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share')
    iframe.setAttribute('allowfullscreen', 'true')
    iframe.setAttribute('frameborder', '0')
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
    card.replaceWith(iframe)
  })
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true

  // Finder does not always send a MIME type with a dragged file. Recognising
  // common image filename endings means a plain .jpg still works as expected.
  return /\.(apng|avif|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(file.name)
}

function isImagePath(path: string): boolean {
  return /\.(apng|avif|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(path)
}

function getImageMimeType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()

  // File paths supplied by Tauri do not include a MIME type, so translate the
  // familiar filename ending into the value FileReader and the editor expect.
  const mimeTypes: Record<string, string> = {
    apng: 'image/apng',
    avif: 'image/avif',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    webp: 'image/webp',
  }

  return extension ? mimeTypes[extension] ?? 'application/octet-stream' : 'application/octet-stream'
}

function getFileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || 'Journal image'
}

function getImageFile(files: FileList | File[]): File | undefined {
  return Array.from(files).find(isImageFile)
}

function getDraggedImageFile(dataTransfer: DataTransfer): File | undefined {
  const fileFromList = getImageFile(dataTransfer.files)
  if (fileFromList) return fileFromList

  // Some macOS drags expose files through DataTransferItem instead of the
  // simpler files list, so check both routes before deciding this is not image.
  const itemFiles = Array.from(dataTransfer.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)

  return getImageFile(itemFiles)
}

function readImageFile(imageFile: File): Promise<{ src: string; name: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve({ src: reader.result, name: imageFile.name || 'Journal image' })
      : reject(new Error('The image could not be decoded.'))
    reader.onerror = () => reject(reader.error ?? new Error('The image could not be read.'))
    reader.onabort = () => reject(new Error('Image loading was interrupted.'))
    reader.readAsDataURL(imageFile)
  })
}

function insertImageFile(view: EditorView, imageFile: File, dropPosition?: number) {
  return insertLoadedImage(view, () => readImageFile(imageFile), dropPosition)
}

function insertImagePath(view: EditorView, imagePath: string, dropPosition?: number) {
  // Register the insertion before the first asynchronous read, so every edit
  // during loading can move (or cancel) its destination safely.
  return insertLoadedImage(view, async () => {
    const bytes = await readFile(imagePath)
    return readImageFile(new File([bytes], getFileNameFromPath(imagePath), {
      type: getImageMimeType(imagePath),
    }))
  }, dropPosition)
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
      if (element.matches('figure[data-journal-diagram]') && ['data-journal-diagram', 'data-diagram-id'].includes(attribute.name)) return
      if (element.tagName.toLowerCase() === 'a' && attribute.name === 'href') return
      if (element.tagName.toLowerCase() === 'img' && ['src', 'alt', 'title'].includes(attribute.name)) return
      if (element.tagName.toLowerCase() === 'iframe' && ['src', 'title', 'allow', 'allowfullscreen', 'frameborder', 'referrerpolicy'].includes(attribute.name)) return
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

  replaceYouTubeCardsForClipboard(container)
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
  onSnapshot,
  suspended = false,
  onError,
  typewriterMode,
  scrollToDate,
  onScrollToDateDone,
  onActiveEntryDateChange,
  autoFocus = false,
  variant = 'standard',
  editable = true,
  onBridgeReady,
}: Props) {
  const snapshotCache = useRef(new EditorSnapshotCache())
  const lastValueRef = useRef(value)
  const lastSyncedHtmlRef = useRef(value)
  const documentChangedRef = useRef(false)
  const importedHtmlRef = useRef(value)
  const importedDocumentRef = useRef<TiptapEditor['state']['doc'] | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const typewriterRef = useRef(typewriterMode)
  const previousTypewriterModeRef = useRef(typewriterMode)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reminderRailFrameRef = useRef<number | null>(null)
  const cursorCenter = useRef(createCursorCenterScheduler())
  const [reminderRail, setReminderRail] = useState<ReminderRailState | null>(null)
  typewriterRef.current = typewriterMode

  // Only gutter gestures are handled here. Text gestures remain entirely
  // native to ProseMirror/WebKit, including word selection and dragging.
  function positionNearClick(clientX: number, clientY: number): number | null {
    if (!editor) return null
    const rect = editor.view.dom.getBoundingClientRect()
    return editor.view.posAtCoords({
      left: Math.max(rect.left + 1, Math.min(clientX, rect.right - 1)),
      top: Math.max(rect.top + 1, Math.min(clientY, rect.bottom - 1)),
    })?.pos ?? Math.max(1, editor.state.doc.content.size - 1)
  }

  const gutterCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => gutterCleanup.current?.(), [])

  function startGutterSelection(event: React.MouseEvent) {
    if (!editor || !editable || event.button !== 0) return
    if ((event.target as HTMLElement).closest('.ProseMirror')) return
    const position = positionNearClick(event.clientX, event.clientY)
    if (position === null) return
    event.preventDefault()
    gutterCleanup.current?.()
    const anchor = event.shiftKey ? editor.state.selection.anchor : position
    // focus() on the view is synchronous. The command schedules another focus
    // and selection restoration on the next frame, interrupting a mouse drag.
    editor.view.focus()
    editor.commands.setTextSelection({ from: anchor, to: position })
    const move = (e: MouseEvent) => {
      const head = positionNearClick(e.clientX, e.clientY)
      if (head !== null && !editor.isDestroyed) {
        editor.commands.setTextSelection({ from: anchor, to: head })
      }
    }
    const cleanup = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', cleanup)
      window.removeEventListener('blur', cleanup)
      gutterCleanup.current = null
    }
    gutterCleanup.current = cleanup
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', cleanup)
    window.addEventListener('blur', cleanup)
  }

  function flushEditorSync(editor: TiptapEditor) {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current)
      syncTimerRef.current = null
    }

    const snapshot = snapshotCache.current.read(editor.state.doc)
    // Parsing into the editor's schema may normalize or omit unfamiliar HTML.
    // Merely saving/focusing must not treat that normalization as a user edit.
    if (!documentChangedRef.current) return { ...snapshot, html: lastValueRef.current }
    const nextHtml = importedDocumentRef.current?.eq(editor.state.doc)
      ? importedHtmlRef.current : snapshot.html
    documentChangedRef.current = false
    lastValueRef.current = nextHtml

    if (nextHtml !== lastSyncedHtmlRef.current) {
      lastSyncedHtmlRef.current = nextHtml
      onChange(nextHtml, snapshot)
    }
    return snapshot
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

  function updateDailyReminders(date: Date, items: DailyReminder[]) {
    if (!editor) return

    const headingPosition = getReminderHeadingPosition(editor, date)
    if (headingPosition === null) return

    const heading = editor.state.doc.nodeAt(headingPosition)
    if (!heading) return

    // Updating the heading attribute creates a normal TipTap transaction, so
    // the reminders use the journal's existing autosave path automatically.
    const transaction = editor.state.tr
      .setNodeMarkup(headingPosition, undefined, {
        ...heading.attrs,
        dailyReminders: items.length > 0 ? JSON.stringify(items) : null,
      })
      .setMeta('dailyReminders', true)
    editor.view.dispatch(transaction)

    setReminderRail((current) => current && isoDate(current.date) === isoDate(date)
      ? { ...current, items }
      : current)
  }

  const editor = useEditor({
    shouldRerenderOnTransaction: false,
    extensions: [
      StarterKit,
      Extension.create({ name: 'pendingImages', addProseMirrorPlugins: () => [pendingImagePlugin()] }),
      EmDashShortcut,
      DailyReminderHeadingData,
      ImageNode,
      YouTubeEmbed,
      JournalDiagramNode.configure({ onError: error => onError?.(error) }),
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
        if (!editor || !editor.isEditable || event.metaKey || event.ctrlKey || event.altKey) {
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
      handleClick: (_view, _position, event) => {
        const target = event.target as HTMLElement
        const trigger = target.closest<HTMLElement>('[data-youtube-url]')
        const url = trigger?.getAttribute('data-youtube-url')
        if (!url) return false

        // Opening in the default browser gives YouTube the normal web context
        // it requires, while keeping the journal on the current entry.
        event.preventDefault()
        void openExternalUrl(url).catch(error => onError?.(error))
        return true
      },
      handlePaste: (view, event) => {
        if (!view.editable) return false
        const clipboard = event.clipboardData
        if (!clipboard) return false

        const imageFile = getImageFile(clipboard.files)
        if (imageFile) {
          void insertImageFile(view, imageFile).catch(error => onError?.(error))
          return true
        }

        // Paste a standalone YouTube link to turn it into a journal video card.
        // Other links and ordinary text keep TipTap's normal paste behaviour.
        const embedUrl = getYouTubeEmbedUrl(clipboard.getData('text/plain'))
        const embedType = view.state.schema.nodes.youtubeEmbed
        if (!embedUrl || !embedType) return false

        view.dispatch(view.state.tr.replaceSelectionWith(embedType.create({
          src: embedUrl,
          videoId: getYouTubeVideoId(embedUrl),
        })).scrollIntoView())
        return true
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !view.editable) return false

        const imageFile = event.dataTransfer ? getDraggedImageFile(event.dataTransfer) : undefined
        if (!imageFile) return false

        const dropPosition = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        event.preventDefault()
        void insertImageFile(view, imageFile, dropPosition).catch(error => onError?.(error))
        return true
      },
    },
    content: value,
    editable,
    onUpdate: ({ editor, transaction }) => {
      documentChangedRef.current = true
      // In typewriter mode, only re-centre after the document actually changes.
      // This avoids the jumpy feeling when the user clicks, drags, or highlights
      // text somewhere else in the editor.
      if (!transaction.getMeta('dailyReminders') && !transaction.getMeta('journalDiagramEdit') && typewriterRef.current && scrollerRef.current) {
        cursorCenter.current.schedule(editor as TiptapEditor, scrollerRef.current)
      }

      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      syncTimerRef.current = setTimeout(() => {
        flushEditorSync(editor as TiptapEditor)
      }, CHANGE_SYNC_DELAY)
    },
    onBlur: ({ editor }) => {
      flushEditorSync(editor as TiptapEditor)
    },
    onSelectionUpdate: ({ editor }) => {
      onActiveEntryDateChange?.(getEntryDateAtCursor(editor as TiptapEditor))
    },
  })

  useEffect(() => {
    if (!onBridgeReady) return
    if (!editor) {
      onBridgeReady(null)
      return
    }

    onBridgeReady({
      runNativeCommand: (command: string) => {
        if (!editable) return
        if (command === 'focus') {
          editor.view.focus()
          if (typewriterRef.current && scrollerRef.current) cursorCenter.current.schedule(editor, scrollerRef.current)
          return
        }
        const chain = editor.chain().focus()
        switch (command) {
          case 'bold': chain.toggleBold().run(); break
          case 'italic': chain.toggleItalic().run(); break
          case 'underline': chain.toggleUnderline().run(); break
          case 'bulletList': chain.toggleBulletList().run(); break
          case 'orderedList': chain.toggleOrderedList().run(); break
          case 'blockquote': chain.toggleBlockquote().run(); break
          case 'undo': chain.undo().run(); break
          case 'redo': chain.redo().run(); break
        }
      },
      getLatestHtml: () => {
        flushEditorSync(editor)
        return lastValueRef.current
      },
      getSnapshot: () => flushEditorSync(editor),
      insertImageDataUrl: (dataUrl: string, name: string) => {
        const imageType = editor.state.schema.nodes.image
        if (!imageType || !editable) return
        editor.view.dispatch(editor.state.tr.replaceSelectionWith(imageType.create({
          src: dataUrl,
          alt: name,
        })).scrollIntoView())
      },
    })

    return () => onBridgeReady(null)
  }, [editor, editable, onBridgeReady])

  useEffect(() => {
    // Changing protection alone is not a document edit.
    editor?.setEditable(editable, false)
    // Notify atom node views (including an open diagram window) about a new
    // read-only state without treating it as a document edit or starting a save.
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('journalEditableChanged', true))
  }, [editor, editable])

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      if (reminderRailFrameRef.current) cancelAnimationFrame(reminderRailFrameRef.current)
      cursorCenter.current.cancel()
    }
  }, [])

  useEffect(() => {
    if (!editor || variant !== 'standard' || suspended) {
      setReminderRail(null)
      return
    }

    const scroller = scrollerRef.current
    if (!scroller) return
    const activeScroller = scroller

    let headingsDirty = true
    let datedHeadings: { element: HTMLHeadingElement; date: Date }[] = []

    function updateReminderRail() {
      reminderRailFrameRef.current = null

      const scrollerRect = activeScroller.getBoundingClientRect()
      if (headingsDirty) {
        datedHeadings = Array.from(editor.view.dom.querySelectorAll<HTMLHeadingElement>('h2'))
          .flatMap(element => {
            const date = parseHeadingDate(element.textContent ?? '')
            return date ? [{ element, date }] : []
          })
        headingsDirty = false
      }

      if (datedHeadings.length === 0) {
        setReminderRail(null)
        return
      }

      // The midpoint is the part of the page the user is most likely reading.
      // Whichever dated section owns that point supplies the visible card.
      const readingLine = scrollerRect.top + scrollerRect.height * 0.48
      // Headings appear in page order. Binary search measures about ten
      // headings in a thousand-entry journal, instead of all thousand.
      let low = 0
      let high = datedHeadings.length
      while (low < high) {
        const middle = (low + high) >>> 1
        if (datedHeadings[middle].element.getBoundingClientRect().top <= readingLine) low = middle + 1
        else high = middle
      }
      const activeIndex = Math.max(0, low - 1)

      const activeHeading = datedHeadings[activeIndex]
      const nextHeading = datedHeadings[activeIndex + 1]
      const headingTop = activeHeading.element.getBoundingClientRect().top - scrollerRect.top
      const nextHeadingTop = nextHeading
        ? nextHeading.element.getBoundingClientRect().top - scrollerRect.top
        : Number.POSITIVE_INFINITY

      // The card normally floats near the middle. Near an entry boundary these
      // limits tether it to its own heading and let the next day's card take over.
      const estimatedHalfCardHeight = 96
      const preferredCentre = scrollerRect.height * 0.48
      const entryStart = headingTop + estimatedHalfCardHeight
      const entryEnd = nextHeadingTop - estimatedHalfCardHeight
      const top = Math.max(
        estimatedHalfCardHeight + 14,
        Math.min(
          scrollerRect.height - estimatedHalfCardHeight - 14,
          Math.max(entryStart, Math.min(preferredCentre, entryEnd)),
        ),
      )

      const items = parseDailyReminders(activeHeading.element.getAttribute('data-daily-reminders'))
      setReminderRail(current => current && current.date.getTime() === activeHeading.date.getTime()
        && current.top === top && JSON.stringify(current.items) === JSON.stringify(items)
        ? current
        : { date: activeHeading.date, items, top })
    }

    function scheduleReminderRailUpdate() {
      if (reminderRailFrameRef.current !== null) return
      reminderRailFrameRef.current = requestAnimationFrame(updateReminderRail)
    }

    // Scrolling changes the active day, while DOM and size changes cover new
    // entries, edited reminder data, window resizing, and typewriter spacing.
    activeScroller.addEventListener('scroll', scheduleReminderRailUpdate, { passive: true })
    const mutationObserver = new MutationObserver(records => {
      // Text changes in an ordinary paragraph do not change the date index.
      // Rebuild it only for edited headings or added/removed heading elements.
      headingsDirty ||= records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement
        if (target?.closest('h2')) return true
        return [...record.addedNodes, ...record.removedNodes].some(node =>
          node instanceof Element && (node.matches('h2') || node.querySelector('h2')))
      })
      scheduleReminderRailUpdate()
    })
    mutationObserver.observe(editor.view.dom, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
      attributeFilter: ['data-daily-reminders'],
    })
    const resizeObserver = new ResizeObserver(scheduleReminderRailUpdate)
    resizeObserver.observe(activeScroller)
    scheduleReminderRailUpdate()

    return () => {
      activeScroller.removeEventListener('scroll', scheduleReminderRailUpdate)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      if (reminderRailFrameRef.current !== null) {
        cancelAnimationFrame(reminderRailFrameRef.current)
        reminderRailFrameRef.current = null
      }
    }
  }, [editor, variant, suspended])

  useEffect(() => {
    if (!editor || !isTauri()) return

    let disposed = false
    let stopListening: (() => void) | undefined

    // Tauri catches files dragged from Finder before the browser-style drop
    // event reaches TipTap. Listening to the native event is therefore the
    // reliable desktop route; the ordinary handlers below remain useful when
    // this editor is run in a normal browser.
    void getCurrentWebview().onDragDropEvent(async ({ payload }) => {
      if (payload.type !== 'drop' || disposed || editor.isDestroyed || !editor.isEditable) return

      const imagePath = payload.paths.find(isImagePath)
      const scroller = scrollerRef.current
      if (!imagePath || !scroller) return

      try {
        const scaleFactor = await getCurrentWindow().scaleFactor()
        if (disposed || editor.isDestroyed || !editor.isEditable) return
        const clientX = payload.position.x / scaleFactor
        const clientY = payload.position.y / scaleFactor
        const topmostElement = document.elementFromPoint(clientX, clientY)

        // The main editor and Focus View can exist at the same time. Only the
        // editor visibly underneath the pointer should receive the image.
        if (!topmostElement || !scroller.contains(topmostElement)) return

        const dropPosition = editor.view.posAtCoords({
          left: clientX,
          top: clientY,
        })?.pos

        await insertImagePath(editor.view, imagePath, dropPosition)
      } catch (error) {
        if (!disposed) onError?.(error)
      }
    }).then((unlisten) => {
      if (disposed) unlisten()
      else stopListening = unlisten
    }).catch((error) => {
      if (!disposed) onError?.(error)
    })

    return () => {
      disposed = true
      stopListening?.()
    }
  }, [editor])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const previousMode = previousTypewriterModeRef.current

    if (!scroller || previousMode === typewriterMode) return

    previousTypewriterModeRef.current = typewriterMode

    cursorCenter.current.cancel()
    if (!typewriterMode || !editor) return

    // Measure after mode-dependent padding has reached layout.
    cursorCenter.current.schedule(editor, scroller)
    return () => cursorCenter.current.cancel()
  }, [typewriterMode, editor])

  // External value changes (file open / new day)
  useEffect(() => {
    if (!editor) return
    if (value !== lastValueRef.current) {
      lastValueRef.current = value
      lastSyncedHtmlRef.current = value
      if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null }
      documentChangedRef.current = false
      importedHtmlRef.current = value
      editor.commands.setContent(value, { emitUpdate: false })
      importedDocumentRef.current = editor.state.doc
    }
    if (!importedDocumentRef.current) importedDocumentRef.current = editor.state.doc
    onSnapshot?.(snapshotCache.current.read(editor.state.doc))
  }, [value, editor])

  useEffect(() => {
    if (!editor || !autoFocus) return

    // The focus panel appears over the main editor. Delaying one frame lets
    // its opening animation begin before we move the typing caret into it.
    const frame = requestAnimationFrame(() => {
      // Command focus schedules another frame and scrollIntoView, which can
      // override typewriter centering. Focus synchronously without scrolling.
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)))
      editor.view.focus()
      if (typewriterRef.current && scrollerRef.current) {
        cursorCenter.current.schedule(editor, scrollerRef.current)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [editor, autoFocus])

  // Scroll to the end of today's section (or jumped-to date) so the cursor
  // is ready to type.  We pick the LAST heading matching the date, then walk
  // forward to the next dated H2 (or end of doc) and place
  // the cursor just before it.
  useEffect(() => {
    if (!editor || !scrollToDate) return
    const cursorPos = findEntryEnd(editor.state.doc, scrollToDate)
    if (cursorPos === null) {
      onScrollToDateDone()
      return
    }

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
    <div className={`editor-wrap editor-${variant}`}>
      <EditorToolbar editor={editor} editable={editable} />
      <div className="editor-viewport">
        {variant === 'standard' && <div className="editor-reading-surface" aria-hidden="true" />}
        {variant === 'standard' && reminderRail && editable && (
          <DailyReminders
            key={isoDate(reminderRail.date)}
            date={reminderRail.date}
            items={reminderRail.items}
            top={reminderRail.top}
            onChange={(items) => updateDailyReminders(reminderRail.date, items)}
          />
        )}
        <div
          ref={scrollerRef}
          className={`editor-scroll${typewriterMode ? ' typewriter' : ''}`}
          onDragOver={(event) => {
            if (!editable || !getDraggedImageFile(event.dataTransfer)) return

            // Tell macOS and the browser this exact writing surface accepts
            // image files, which is required for a Finder drop to reach us.
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }}
          onDropCapture={(event) => {
            const imageFile = getDraggedImageFile(event.dataTransfer)
            if (!imageFile || !editor || !editable) return

            // Capture the Finder drop before ProseMirror can treat it as an
            // ordinary drag. That makes .jpg files reliable in the desktop app.
            event.preventDefault()
            event.stopPropagation()
            const dropPosition = editor.view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            })?.pos
            void insertImageFile(editor.view, imageFile, dropPosition).catch(error => onError?.(error))
          }}
          onMouseDown={startGutterSelection}
        >
          <div ref={contentRef} className="editor-content">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </div>
  )
}
