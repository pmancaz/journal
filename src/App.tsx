import { useState, useEffect, useCallback, useRef, useDeferredValue } from 'react'
import Toolbar from './components/Toolbar'
import Editor, { EditorBridge } from './components/Editor'
import FocusView from './components/FocusView'
import RightLibraryPanel from './components/RightLibraryPanel'
import {
  exportMarkdownFile,
  getOpenFilePath,
  hasFileOpen,
  newHtmlFile,
  openHtmlFile,
  openHtmlFileAtPath,
  writeHtmlFile,
} from './lib/fileStorage'
import {
  hasEntryForDate,
  appendDateHeading,
  getCurrentDaySection,
  getYearEntryText,
  getEntryBodyHtml,
  replaceEntryBodyHtml,
  extractEntries,
  groupEntriesByMonth,
} from './lib/journal'
import { countWords } from './lib/wordCount'
import { MonthGroup } from './lib/journal'

type SaveState = 'saved' | 'saving' | 'unsaved'
type Theme = 'day' | 'night' | 'nautical'

const AUTOSAVE_DELAY = 800
const RECENT_FILES_KEY = 'journal-recent-files'
const MAX_RECENT_FILES = 8

function getInitialTheme(): Theme {
  const savedTheme = localStorage.getItem('journal-theme')

  // A saved preference can outlive a later app update. Only reuse recognised
  // theme names so an old or manually edited setting cannot leave the app
  // without matching colours.
  if (savedTheme === 'night' || savedTheme === 'nautical') return savedTheme

  return 'day'
}

function getInitialSaveLightSetting(): boolean {
  return localStorage.getItem('journal-save-light') === 'on'
}

function getInitialRecentFiles(): string[] {
  try {
    const saved = localStorage.getItem(RECENT_FILES_KEY)
    if (!saved) return []

    const parsed = JSON.parse(saved)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function getFileLabel(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1] || filePath
}

function getCompactFilePath(filePath: string): string {
  const maxLength = 74
  if (filePath.length <= maxLength) return filePath

  const parts = filePath.split('/').filter(Boolean)

  if (parts.length > 4) {
    // Middle-truncate long paths so the launch screen still shows both the
    // broad location and the actual file being opened.
    const prefix = filePath.startsWith('/') ? '/' : ''
    const start = `${prefix}${parts.slice(0, 4).join('/')}`
    const end = parts.slice(-2).join('/')
    const compactPath = `${start}/.../${end}`

    if (compactPath.length <= maxLength) return compactPath
  }

  return `${filePath.slice(0, 30)}...${filePath.slice(-34)}`
}

export default function App() {
  const [html, setHtml] = useState('<p></p>')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [typewriterMode, setTypewriterMode] = useState(false)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [showSaveLight, setShowSaveLight] = useState(getInitialSaveLightSetting)
  const [fileOpen, setFileOpen] = useState(false)
  const [recentFiles, setRecentFiles] = useState(getInitialRecentFiles)
  const [monthGroups, setMonthGroups] = useState<MonthGroup[]>([])
  const [todayWords, setTodayWords] = useState(0)
  const [totalWords, setTotalWords] = useState(0)
  const [scrollToDate, setScrollToDate] = useState<Date | null>(null)
  const [activeEntryDate, setActiveEntryDate] = useState<Date | null>(null)
  const [focusDate, setFocusDate] = useState<Date | null>(null)

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const htmlRef = useRef(html)
  const editorBridgeRef = useRef<EditorBridge | null>(null)
  const deferredHtml = useDeferredValue(html)
  htmlRef.current = html

  function getLatestHtml(): string {
    return editorBridgeRef.current?.getLatestMarkdown() ?? htmlRef.current
  }

  // Apply theme to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('journal-theme', theme)
  }, [theme])

  function cycleTheme() {
    // Keep all three appearances one click apart: the neutral modes remain
    // quick to reach, while Nautical is an optional focused writing setting.
    setTheme((current) => {
      if (current === 'day') return 'night'
      if (current === 'night') return 'nautical'
      return 'day'
    })
  }

  useEffect(() => {
    localStorage.setItem('journal-save-light', showSaveLight ? 'on' : 'off')
  }, [showSaveLight])

  useEffect(() => {
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(recentFiles))
  }, [recentFiles])

  function rememberRecentFile(nextPath: string | null) {
    if (!nextPath) return

    // Keep the newest file at the top so the launch screen behaves like a
    // small "continue where I left off" list.
    setRecentFiles((current) => [
      nextPath,
      ...current.filter((item) => item !== nextPath),
    ].slice(0, MAX_RECENT_FILES))
  }

  function forgetRecentFile(targetPath: string) {
    setRecentFiles((current) => current.filter((item) => item !== targetPath))
  }

  // Recompute the date library and word totals from a deferred copy of the
  // document so typing can stay responsive even when the journal file is large.
  useEffect(() => {
    const today = new Date()
    const entries = extractEntries(deferredHtml)

    setTodayWords(countWords(getCurrentDaySection(deferredHtml, today)))
    setTotalWords(countWords(getYearEntryText(deferredHtml, today.getFullYear())))
    setMonthGroups(groupEntriesByMonth(entries))
  }, [deferredHtml])

  const handleChange = useCallback((value: string) => {
    // Update the ref straight away as well as React state. The focus panel can
    // produce several quick edits before React has finished re-rendering.
    htmlRef.current = value
    setHtml(value)
    setSaveState('unsaved')

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(async () => {
      setSaveState('saving')
      const ok = await writeHtmlFile(value)
      setSaveState(ok ? 'saved' : 'unsaved')
    }, AUTOSAVE_DELAY)
  }, [])

  const handleNewFile = useCallback(async () => {
    const ok = await newHtmlFile()
    if (ok) {
      setHtml('<p></p>')
      setFileOpen(true)
      setSaveState('saved')
      rememberRecentFile(getOpenFilePath())
    }
  }, [])

  const handleOpenFile = useCallback(async () => {
    const content = await openHtmlFile()
    if (content !== null) {
      setHtml(content)
      setFileOpen(true)
      setSaveState('saved')
      rememberRecentFile(getOpenFilePath())
    }
  }, [])

  const handleOpenRecentFile = useCallback(async (targetPath: string) => {
    const content = await openHtmlFileAtPath(targetPath)

    if (content === null) {
      // If the file moved or was deleted, quietly remove it from the list so
      // the launch screen does not keep offering a broken shortcut.
      forgetRecentFile(targetPath)
      return
    }

    setHtml(content)
    setFileOpen(true)
    setSaveState('saved')
    rememberRecentFile(targetPath)
  }, [])

  const openFocusForDate = useCallback((date: Date) => {
    const latestHtml = getLatestHtml()

    // Keep the rendered document aligned with a just-flushed background editor
    // before extracting this entry for the separate focus editor.
    htmlRef.current = latestHtml
    setHtml(latestHtml)

    setActiveEntryDate(date)
    setFocusDate(date)
  }, [])

  const handleNewDay = useCallback(() => {
    const today = new Date()
    const latestHtml = getLatestHtml()

    // Today remains the fast navigation action: create a missing section, then
    // bring the full journal editor down to that entry rather than opening focus.
    if (!hasEntryForDate(latestHtml, today)) {
      handleChange(appendDateHeading(latestHtml, today))
    } else {
      htmlRef.current = latestHtml
      setHtml(latestHtml)
    }

    setActiveEntryDate(today)
    requestAnimationFrame(() => setScrollToDate(today))
  }, [handleChange])

  const handleExportMarkdown = useCallback(async () => {
    await exportMarkdownFile(getLatestHtml())
  }, [])

  const handleJumpToDate = useCallback((date: Date) => {
    setScrollToDate(date)
    setActiveEntryDate(date)
  }, [])

  const handleScrollToDateDone = useCallback(() => setScrollToDate(null), [])

  const handleActiveEntryDateChange = useCallback((date: Date | null) => {
    setActiveEntryDate((currentDate) => {
      if (currentDate?.getTime() === date?.getTime()) return currentDate
      return date
    })
  }, [])

  const handleFocusChange = useCallback((entryHtml: string) => {
    if (!focusDate) return

    const nextDocument = replaceEntryBodyHtml(htmlRef.current, focusDate, entryHtml)
    handleChange(nextDocument)
  }, [focusDate, handleChange])

  // Cmd+S save
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (!hasFileOpen()) return
        setSaveState('saving')
        const ok = await writeHtmlFile(getLatestHtml())
        setSaveState(ok ? 'saved' : 'unsaved')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="app">
      <Toolbar
        onNewDay={handleNewDay}
        onFocusCurrent={() => {
          if (activeEntryDate) openFocusForDate(activeEntryDate)
        }}
        focusAvailable={activeEntryDate !== null}
        onNewFile={handleNewFile}
        onOpenFile={handleOpenFile}
        onExportMarkdown={handleExportMarkdown}
        saveState={saveState}
        todayWords={todayWords}
        totalWords={totalWords}
        typewriterMode={typewriterMode}
        onToggleTypewriter={() => setTypewriterMode(t => !t)}
        showSaveLight={showSaveLight}
        onToggleSaveLight={() => setShowSaveLight(value => !value)}
        theme={theme}
        onCycleTheme={cycleTheme}
        fileOpen={fileOpen}
      />
      <div className="layout">
        {fileOpen ? (
          <Editor
            value={html}
            onChange={handleChange}
            typewriterMode={typewriterMode}
            scrollToDate={scrollToDate}
            onScrollToDateDone={handleScrollToDateDone}
            onActiveEntryDateChange={handleActiveEntryDateChange}
            onBridgeReady={(bridge) => {
              editorBridgeRef.current = bridge
            }}
          />
        ) : (
          <div className="editor-wrap editor-empty">
            <div className="empty-state">
              <div className="empty-state-title">journal</div>
              <div className="empty-state-sub">choose a file to open</div>
              <button className="empty-state-btn" onClick={handleOpenFile}>
                open file
              </button>
              {recentFiles.length > 0 && (
                <div className="empty-state-recents">
                  <div className="empty-state-recents-label">recent files</div>
                  {recentFiles.map((recentPath) => (
                    <div key={recentPath} className="empty-state-recent-row">
                      <button
                        className="empty-state-recent-btn"
                        onClick={() => handleOpenRecentFile(recentPath)}
                        title={recentPath}
                      >
                        <span className="empty-state-recent-name">{getFileLabel(recentPath)}</span>
                        <span className="empty-state-recent-path">{getCompactFilePath(recentPath)}</span>
                      </button>
                      <button
                        className="empty-state-recent-remove"
                        onClick={() => forgetRecentFile(recentPath)}
                        title={`Remove ${getFileLabel(recentPath)} from recent files`}
                        aria-label={`Remove ${getFileLabel(recentPath)} from recent files`}
                      >
                        remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <RightLibraryPanel groups={monthGroups} onJumpToDate={handleJumpToDate} />
      </div>
      {focusDate && (
        <FocusView
          date={focusDate}
          value={getEntryBodyHtml(html, focusDate)}
          onChange={handleFocusChange}
          onClose={() => setFocusDate(null)}
        />
      )}
    </div>
  )
}
