type SaveState = 'saved' | 'saving' | 'unsaved'

type Props = {
  onNewDay: () => void
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
  theme: 'day' | 'night'
  onToggleTheme: () => void
  fileOpen: boolean
}

export default function Toolbar({
  onNewDay,
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
  onToggleTheme,
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
            new day
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
        >
          save light
        </button>
        <span className="toolbar-sep">·</span>
        <button className="toolbar-btn" onClick={onToggleTheme}>
          {theme === 'day' ? '[ ○ day ]' : '[ ● night ]'}
        </button>
      </div>
    </header>
  )
}
