import { useEffect, useRef, useState } from 'react'
import Editor, { EditorBridge } from './Editor'
import { formatJournalDate } from '../lib/dates'
import { EditorSnapshot } from '../lib/editorSnapshot'

type Props = {
  date: Date
  value: string
  onChange: (value: string, snapshot: EditorSnapshot) => void
  onBridgeReady: (bridge: EditorBridge | null) => void
  onError: (error: unknown) => void
  onClose: () => void
  editable?: boolean
}

export default function FocusView({ date, value, onChange, onClose, onBridgeReady, onError, editable = true }: Props) {
  const editorBridgeRef = useRef<EditorBridge | null>(null)
  // Focus starts with the same preferred typewriter setting as the main editor.
  const [typewriterMode, setTypewriterMode] = useState(true)
  const [entryWords, setEntryWords] = useState(0)

  function closeFocusView() {
    // Ask TipTap for its newest value before closing, so the final few typed
    // characters are included even if its short sync delay has not elapsed.
    editorBridgeRef.current?.getLatestHtml()
    onClose()
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeFocusView()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="focus-overlay" role="presentation" onMouseDown={closeFocusView}>
      <section
        className="focus-window"
        role="dialog"
        aria-modal="true"
        aria-label={`focus view for ${formatJournalDate(date)}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="focus-window-header">
          <div>
            <div className="focus-window-label">focus view</div>
            <div className="focus-window-date">{formatJournalDate(date)}</div>
          </div>
          <div className="focus-window-actions">
            <span className="focus-wordcount">
              <span>words</span> {entryWords.toLocaleString()}
            </span>
            <button
              className={`focus-typewriter${typewriterMode ? ' focus-typewriter-active' : ''}`}
              type="button"
              onClick={() => setTypewriterMode((current) => !current)}
              aria-pressed={typewriterMode}
              disabled={!editable}
            >
              typewriter
            </button>
            <button className="focus-close" type="button" onClick={closeFocusView}>
              close <span aria-hidden="true">×</span>
            </button>
          </div>
        </header>
        <Editor
          value={value}
          onChange={(html, snapshot) => {
            setEntryWords(snapshot.words)
            onChange(html, snapshot)
          }}
          onSnapshot={snapshot => setEntryWords(snapshot.words)}
          onError={onError}
          typewriterMode={typewriterMode}
          scrollToDate={null}
          onScrollToDateDone={() => undefined}
          autoFocus
          variant="focus"
          editable={editable}
          onBridgeReady={(bridge) => {
            editorBridgeRef.current = bridge
            onBridgeReady(bridge)
          }}
        />
      </section>
    </div>
  )
}
