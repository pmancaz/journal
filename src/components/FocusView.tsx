import { useEffect, useRef, useState } from 'react'
import Editor, { EditorBridge } from './Editor'
import { formatJournalDate } from '../lib/dates'
import { getPlainTextFromHtml } from '../lib/journal'
import { countWords } from '../lib/wordCount'

type Props = {
  date: Date
  value: string
  onChange: (value: string) => void
  onClose: () => void
}

export default function FocusView({ date, value, onChange, onClose }: Props) {
  const editorBridgeRef = useRef<EditorBridge | null>(null)
  const [typewriterMode, setTypewriterMode] = useState(false)
  const entryWords = countWords(getPlainTextFromHtml(value))

  function closeFocusView() {
    // Ask TipTap for its newest value before closing, so the final few typed
    // characters are included even if its short sync delay has not elapsed.
    const latestValue = editorBridgeRef.current?.getLatestMarkdown()
    if (latestValue !== undefined) onChange(latestValue)
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
          onChange={onChange}
          typewriterMode={typewriterMode}
          scrollToDate={null}
          onScrollToDateDone={() => undefined}
          autoFocus
          variant="focus"
          onBridgeReady={(bridge) => {
            editorBridgeRef.current = bridge
          }}
        />
      </section>
    </div>
  )
}
