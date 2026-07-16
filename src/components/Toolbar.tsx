type SaveState = 'saved' | 'saving' | 'unsaved'

type Props = {
  onNewDay: () => void
  onFocusCurrent: () => void
  focusAvailable: boolean
  onNewFile: () => void
  onOpenFile: () => void
  onExportMarkdown: () => void
  saveState: SaveState
  todayWords: number
  totalWords: number
  typewriterMode: boolean
  onToggleTypewriter: () => void
  showSaveLight: boolean
  onToggleSaveLight: () => void
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
  onExportMarkdown,
  saveState,
  todayWords,
  totalWords,
  typewriterMode,
  onToggleTypewriter,
  showSaveLight,
  onToggleSaveLight,
  theme,
  onCycleTheme,
  fileOpen,
}: Props) {
  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <span className="toolbar-app-name">journal</span>
        <button className="toolbar-btn" onClick={onNewFile}>
          new file
        </button>
        <button className="toolbar-btn" onClick={onOpenFile}>
          open file
        </button>
        {fileOpen && (
          <button className="toolbar-btn" onClick={onExportMarkdown}>
            export md
          </button>
        )}
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
            {showSaveLight && (
              <>
                <span className="toolbar-sep">·</span>
                <span
                  className={`toolbar-save-light toolbar-save-light-${saveState}`}
                  title={
                    saveState === 'saved'
                      ? 'saved'
                      : saveState === 'saving'
                        ? 'saving'
                        : 'unsaved changes'
                  }
                />
              </>
            )}
            <span className="toolbar-sep">·</span>
          </>
        )}
        <button
          className={`toolbar-btn ${showSaveLight ? 'toolbar-btn-active' : ''}`}
          onClick={onToggleSaveLight}
          aria-pressed={showSaveLight}
          title="toggle save light"
        >
          save light
        </button>
        <span className="toolbar-sep">·</span>
        <button className="toolbar-btn" onClick={onCycleTheme} title="change appearance">
          {theme === 'day' && '[ ○ day ]'}
          {theme === 'night' && '[ ● night ]'}
          {theme === 'nautical' && '[ ◈ nautical ]'}
        </button>
      </div>
    </header>
  )
}
