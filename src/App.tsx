import { useState, useEffect, useCallback, useRef, useDeferredValue } from 'react'
import Toolbar from './components/Toolbar'
import Editor, { EditorBridge } from './components/Editor'
import LeftIdeasPanel from './components/LeftIdeasPanel'
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
  extractEntries,
  groupEntriesByMonth,
  getPlainTextFromHtml,
} from './lib/journal'
import { countWords, getFrequentWords, WordFrequency } from './lib/wordCount'
import { MonthGroup } from './lib/journal'

type SaveState = 'saved' | 'saving' | 'unsaved'
type Theme = 'day' | 'night'

const AUTOSAVE_DELAY = 800
const WORD_FREQ_DELAY = 1200
const RECENT_FILES_KEY = 'journal-recent-files'
const MAX_RECENT_FILES = 8

function getInitialTheme(): Theme {
  return (localStorage.getItem('journal-theme') as Theme) ?? 'day'
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

export default function App() {
  const [html, setHtml] = useState('<p></p>')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [typewriterMode, setTypewriterMode] = useState(false)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [showSaveLight, setShowSaveLight] = useState(getInitialSaveLightSetting)
  const [fileOpen, setFileOpen] = useState(false)
  const [recentFiles, setRecentFiles] = useState(getInitialRecentFiles)
  const [wordFreqs, setWordFreqs] = useState<WordFrequency[]>([])
  const [monthGroups, setMonthGroups] = useState<MonthGroup[]>([])
  const [todayWords, setTodayWords] = useState(0)
  const [totalWords, setTotalWords] = useState(0)
  const [scrollToDate, setScrollToDate] = useState<Date | null>(null)

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wordFreqTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  // Recompute the side panels from a deferred copy of the document so typing
  // can stay responsive even when the journal file is large.
  useEffect(() => {
    const today = new Date()
    const entries = extractEntries(deferredHtml)
    const fullText = getPlainTextFromHtml(deferredHtml)

    setTodayWords(countWords(getCurrentDaySection(deferredHtml, today)))
    setTotalWords(countWords(fullText))
    setMonthGroups(groupEntriesByMonth(entries))

    if (wordFreqTimer.current) clearTimeout(wordFreqTimer.current)
    wordFreqTimer.current = setTimeout(() => {
      setWordFreqs(getFrequentWords(fullText, { topN: 30 }))
    }, WORD_FREQ_DELAY)
  }, [deferredHtml])

  const handleChange = useCallback((value: string) => {
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

  const handleNewDay = useCallback(() => {
    const today = new Date()
    const latestHtml = getLatestHtml()

    if (!hasEntryForDate(latestHtml, today)) {
      const updated = appendDateHeading(latestHtml, today)
      handleChange(updated)
    }
    requestAnimationFrame(() => setScrollToDate(new Date()))
  }, [handleChange])

  const handleExportMarkdown = useCallback(async () => {
    await exportMarkdownFile(getLatestHtml())
  }, [])

  const handleJumpToDate = useCallback((date: Date) => {
    setScrollToDate(date)
  }, [])

  const handleScrollToDateDone = useCallback(() => setScrollToDate(null), [])

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
        onToggleTheme={() => setTheme(t => t === 'day' ? 'night' : 'day')}
        fileOpen={fileOpen}
      />
      <div className="layout">
        <LeftIdeasPanel words={wordFreqs} />
        {fileOpen ? (
          <Editor
            value={html}
            onChange={handleChange}
            typewriterMode={typewriterMode}
            scrollToDate={scrollToDate}
            onScrollToDateDone={handleScrollToDateDone}
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
                    <button
                      key={recentPath}
                      className="empty-state-recent-btn"
                      onClick={() => handleOpenRecentFile(recentPath)}
                      title={recentPath}
                    >
                      <span className="empty-state-recent-name">{getFileLabel(recentPath)}</span>
                      <span className="empty-state-recent-path">{recentPath}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <RightLibraryPanel groups={monthGroups} onJumpToDate={handleJumpToDate} />
      </div>
    </div>
  )
}
