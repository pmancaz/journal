import { useEffect, useRef } from 'react'

type SaveState = 'saved' | 'saving' | 'unsaved'

type Props = {
  onNewDay: () => void
  onFocusCurrent: () => void
  focusAvailable: boolean
  onNewFile: () => void
  onOpenFile: () => void
  protectedDraft: boolean
  onReloadFile: () => void
  fileActionPending: boolean
  saveState: SaveState
  todayWords: number
  totalWords: number
  typewriterMode: boolean
  onToggleTypewriter: () => void
  theme: 'day' | 'night' | 'nautical'
  onCycleTheme: () => void
  fileOpen: boolean
}

export default function Toolbar({
  onNewDay,
  onFocusCurrent,
  focusAvailable,
  onNewFile,
  onOpenFile,
  protectedDraft,
  onReloadFile,
  fileActionPending,
  saveState,
  todayWords,
  totalWords,
  typewriterMode,
  onToggleTypewriter,
  theme,
  onCycleTheme,
  fileOpen,
}: Props) {
  const fileMenuRef = useRef<HTMLDetailsElement>(null)

  function runFileAction(action: () => void) {
    if (fileMenuRef.current) fileMenuRef.current.open = false
    action()
  }

  useEffect(() => {
    // Native details/summary supplies keyboard opening. Outside clicks and
    // Escape dismiss the small file menu without changing the journal.
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !fileMenuRef.current?.contains(event.target)
        && fileMenuRef.current) fileMenuRef.current.open = false
    }
    function dismissWithEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !fileMenuRef.current?.open) return
      event.preventDefault()
      fileMenuRef.current.open = false
      fileMenuRef.current.querySelector('summary')?.focus()
    }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('keydown', dismissWithEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('keydown', dismissWithEscape)
    }
  }, [])

  const saveLabel = saveState === 'saved' ? 'saved' : saveState === 'saving' ? 'saving' : 'unsaved changes'

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <span className="toolbar-app-name">Journal</span>
        <details className="toolbar-file-menu" ref={fileMenuRef}>
          <summary className="toolbar-btn" aria-disabled={fileActionPending}
            onClick={event => { if (fileActionPending) event.preventDefault() }}>
            file <span aria-hidden="true">⌄</span>
          </summary>
          <div className="toolbar-file-options">
            <button className="toolbar-btn" onClick={() => runFileAction(onNewFile)} disabled={fileActionPending}>
              new file
            </button>
            <button className="toolbar-btn" onClick={() => runFileAction(onOpenFile)} disabled={fileActionPending}>
              open file
            </button>
            {fileOpen && protectedDraft && (
              <button className="toolbar-btn" onClick={() => runFileAction(onReloadFile)} disabled={fileActionPending}>
                reload journal
              </button>
            )}
          </div>
        </details>
      </div>

      {/* Equal outside columns keep these everyday actions at the actual
          centre of the window, regardless of the word-count length. */}
      <div className="toolbar-center">
        {fileOpen && (
          <button className="toolbar-btn toolbar-btn-primary" onClick={onNewDay}>
            today
          </button>
        )}
        {fileOpen && (
          <button
            className="toolbar-btn"
            onClick={onFocusCurrent}
            disabled={!focusAvailable}
            title={focusAvailable ? 'focus the selected entry' : 'choose an entry from the library first'}
          >
            focus
          </button>
        )}
      </div>

      <div className="toolbar-right">
        {fileOpen && (
          <>
            {protectedDraft && <span className="toolbar-protected-state">protected draft</span>}
            <span className="toolbar-wordcount">
              <span className="toolbar-label">today</span>
              <span className="toolbar-num">{todayWords.toLocaleString()}</span>
            </span>
            <span className="toolbar-sep">·</span>
            <span className="toolbar-wordcount">
              <span className="toolbar-label">year</span>
              <span className="toolbar-num">{totalWords.toLocaleString()}</span>
            </span>
            <span className="toolbar-sep">·</span>
            <button
              className={`toolbar-btn ${typewriterMode ? 'toolbar-btn-active' : ''}`}
              onClick={onToggleTypewriter}
              aria-pressed={typewriterMode}
              title="toggle typewriter mode"
            >
              typewriter
            </button>
            <span className="toolbar-sep">·</span>
            <span
              className={`toolbar-save-light toolbar-save-light-${saveState}`}
              role="status"
              aria-label={saveLabel}
              title={saveLabel}
            />
            <span className="toolbar-sep">·</span>
          </>
        )}
        <button className="toolbar-btn" onClick={onCycleTheme} title="change appearance">
          {theme === 'day' && '[ ○ day ]'}
          {theme === 'night' && '[ ● night ]'}
          {theme === 'nautical' && '[ ◈ nautical ]'}
        </button>
      </div>
    </header>
  )
}
