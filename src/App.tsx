import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import Toolbar from './components/Toolbar'
import Editor, { EditorBridge } from './components/Editor'
import ErrorReportDialog from './components/ErrorReportDialog'
import RecoveryDialog from './components/RecoveryDialog'
import FocusView from './components/FocusView'
import RightLibraryPanel from './components/RightLibraryPanel'
import { RecoveryDraft, documentBackend } from './lib/documentBackend'
import { JournalRevision, SaveResult, getEditorHtml } from './lib/journalDocument'
import {
  hasEntryForDate,
  appendDateHeading,
  groupEntriesByMonth,
} from './lib/journal'
import { createFocusSession, EditorSnapshot, FocusSession, summarizeBlocks } from './lib/editorSnapshot'
import { MonthGroup } from './lib/journal'

type SaveState = 'saved' | 'saving' | 'unsaved'
type Theme = 'day' | 'night' | 'nautical'
type EditingMode = 'editing' | 'protected'

const AUTOSAVE_DELAY = 800
const RECENT_FILES_KEY = 'journal-recent-files'
const MAX_RECENT_FILES = 8

function getDevelopmentReminderPreview(): string | null {
  if (!import.meta.env.DEV) return null
  const preview = new URLSearchParams(window.location.search).get('preview')
  if (preview === 'performance') {
    // A repeatable large-file UI check, using invented text only. Like the
    // reminder preview below, this development view never writes a journal.
    return Array.from({ length: 1000 }, (_, index) => {
      const date = new Date(2024, 0, index + 1)
      return `<h2>${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}</h2>`
        + `<p>${'Synthetic journal words for performance measurement. '.repeat(12)}</p>`.repeat(8)
    }).join('')
  }
  if (preview !== 'reminders') return null

  // This private development view gives visual tests several long dated
  // sections without asking them to open or alter a real journal file.
  const dates = ['2026-08-03 Monday', '2026-08-04 Tuesday', '2026-08-05 Wednesday']
  return dates.map((date, dateIndex) => {
    const paragraphs = Array.from({ length: 12 }, (_, paragraphIndex) => (
      `<p>Preview writing for ${date}, paragraph ${paragraphIndex + 1}. ` +
      'This line gives the entry enough height to test the floating hand-off.</p>'
    )).join('')
    const reminders = dateIndex === 0
      ? ' data-daily-reminders="[{&quot;id&quot;:&quot;preview-one&quot;,&quot;text&quot;:&quot;Move useful idea to project manager&quot;,&quot;done&quot;:false}]"'
      : ''
    return `<h2${reminders}>${date}</h2>${paragraphs}`
  }).join('<hr>')
}

const developmentReminderPreview = getDevelopmentReminderPreview()

function getInitialTheme(): Theme {
  const savedTheme = localStorage.getItem('journal-theme')

  // A saved preference can outlive a later app update. Only reuse recognised
  // theme names so an old or manually edited setting cannot leave the app
  // without matching colours.
  if (savedTheme === 'night' || savedTheme === 'nautical') return savedTheme

  return 'day'
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

function makeUiErrorReport(operation: string, error: unknown): string {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return [
    'PC Journal error report',
    `Time: ${new Date().toISOString()}`,
    `Operation: ${operation}`,
    `File: ${documentBackend.getOpenPath() ?? 'no file selected'}`,
    `This session: ${documentBackend.getSessionId()}`,
    '',
    detail,
  ].join('\n')
}

export default function App() {
  const [html, setHtml] = useState(developmentReminderPreview ?? '<p></p>')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  // Each session starts in the preferred writing mode; the toggle remains available.
  const [typewriterMode, setTypewriterMode] = useState(true)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [fileOpen, setFileOpen] = useState(developmentReminderPreview !== null)
  const [recentFiles, setRecentFiles] = useState(getInitialRecentFiles)
  const [monthGroups, setMonthGroups] = useState<MonthGroup[]>([])
  const [todayWords, setTodayWords] = useState(0)
  const [totalWords, setTotalWords] = useState(0)
  const [scrollToDate, setScrollToDate] = useState<Date | null>(null)
  const [activeEntryDate, setActiveEntryDate] = useState<Date | null>(null)
  const [focusDate, setFocusDate] = useState<Date | null>(null)
  const focusSessionRef = useRef<FocusSession | null>(null)
  const focusBridgeRef = useRef<EditorBridge | null>(null)
  // A fresh editor for each opened/reloaded file also creates fresh Undo history.
  const [documentGeneration, setDocumentGeneration] = useState(0)
  const closePendingRef = useRef(false)
  const closeWarningHtmlRef = useRef<string | null>(null)
  const [errorReport, setErrorReport] = useState<string | null>(null)
  const [editingMode, setEditingMode] = useState<EditingMode>('editing')
  const [libraryCollapsed, setLibraryCollapsed] = useState(true)
  const [fileActionPending, setFileActionPending] = useState(false)
  const fileActionPendingRef = useRef(false)
  const [recoveryDraft, setRecoveryDraft] = useState<RecoveryDraft | null>(null)
  const recoveryDraftRef = useRef(recoveryDraft)
  recoveryDraftRef.current = recoveryDraft

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const htmlRef = useRef(html)
  const editorBridgeRef = useRef<EditorBridge | null>(null)
  const editingModeRef = useRef<EditingMode>(editingMode)
  editingModeRef.current = editingMode

  function getLatestHtml(): string {
    const focused = focusBridgeRef.current
    const session = focusSessionRef.current
    if (focused && session) {
      return session.prefixHtml + focused.getLatestHtml() + session.suffixHtml
    }
    return editorBridgeRef.current?.getLatestHtml() ?? htmlRef.current
  }

  function applyRevision(revision: JournalRevision, nextMode: EditingMode = 'editing') {
    htmlRef.current = revision.editorHtml
    setHtml(revision.editorHtml)
    setFileOpen(true)
    setSaveState('saved')
    editingModeRef.current = nextMode
    setEditingMode(nextMode)
    setFocusDate(null)
    focusSessionRef.current = null
    focusBridgeRef.current = null
    setActiveEntryDate(null)
    setDocumentGeneration(value => value + 1)
    rememberRecentFile(revision.path)
  }

  async function applyOpenedRevision(revision: JournalRevision) {
    // Files open ready to edit. Only an actual unresolved file conflict
    // needs protection; old device ownership tags have no effect.
    applyRevision(revision, revision.conflictCount > 0 ? 'protected' : 'editing')
    if (revision.warning) setErrorReport(revision.warning)
    else if (revision.conflictCount > 0) {
      setErrorReport(makeUiErrorReport('open journal file', 'macOS reports unresolved versions of this file. Resolve the file conflict in Finder, then reload the journal. The writing has not been changed.'))
    }
    const draft = await documentBackend.readLatestDraft()
    if (
      draft &&
      getEditorHtml(draft.fullHtml) !== revision.editorHtml
    ) {
      // Merely offering a recovery draft never changes the journal on disk.
      setRecoveryDraft(draft)
    } else {
      setRecoveryDraft(null)
    }
  }

  async function handleSaveFailure(result: SaveResult) {
    // Flush even text that has not reached the save queue's debounce yet.
    const newest = getLatestHtml()
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    if (result.status === 'remoteChanged' || result.status === 'conflict') {
      editingModeRef.current = 'protected'
      setEditingMode('protected')
    }
    setSaveState('unsaved')
    let report = [result.report, result.warning].filter(Boolean).join('\n\n')
    try {
      await documentBackend.persistDraft(newest)
    } catch (error) {
      report += `\n\n${makeUiErrorReport('preserve latest recovery draft', error)}`
    }
    try {
      const copy = await documentBackend.createRecoveryCopy('conflict', newest)
      if (copy) report += `\n\nNewest recovery copy: ${copy}`
    } catch (error) {
      report += `\n\n${makeUiErrorReport('preserve newest visible draft', error)}`
    }
    setErrorReport(report || makeUiErrorReport('save journal', 'The journal could not be saved.'))
  }

  function handleSaved(result: SaveResult, savedHtml: string) {
    // A save finishing while more typing arrives must not mark that newer text
    // as saved. Reading the active editor also flushes Focus's pending changes.
    if (getLatestHtml() === savedHtml) setSaveState('saved')
    if (result.warning) setErrorReport(result.warning)
  }

  async function closeAfterSaving() {
    if (closePendingRef.current) return
    if (fileActionPendingRef.current) {
      setErrorReport(makeUiErrorReport('close journal', 'Please finish the current file operation, then close again.'))
      return
    }
    closePendingRef.current = true
    let closeApproved = false
    const latest = getLatestHtml()
    fileActionPendingRef.current = true
    setFileActionPending(true)
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    try {
      if (documentBackend.hasOpenDocument() && !recoveryDraftRef.current) {
        if (editingModeRef.current === 'editing') {
          const result = await documentBackend.save(latest)
          if (result.status !== 'saved') {
            await handleSaveFailure(result)
            return
          }
          if (result.warning && closeWarningHtmlRef.current !== latest) {
            // The main file is safe, but do not hide a failed backup by closing
            // its report immediately. A second close can use that saved file.
            closeWarningHtmlRef.current = latest
            setErrorReport(`${result.warning}\n\nThe journal itself was saved. Close again to quit without a new recovery copy.`)
            return
          }
        } else {
          await documentBackend.persistDraft(latest)
          const copy = await documentBackend.createRecoveryCopy('conflict', latest)
          if (!copy) throw new Error('Could not preserve the protected draft. The app remains open.')
        }
      }
      // Native close and Cmd+Q both wait here. Only this command releases the
      // native guard, after the latest writing has reached durable storage.
      await invoke('finish_journal_close')
      closeApproved = true
    } catch (error) {
      setErrorReport(makeUiErrorReport('close journal', error))
    } finally {
      // Keep the editor disabled between native approval and actual exit.
      if (!closeApproved) {
        closePendingRef.current = false
        fileActionPendingRef.current = false
        setFileActionPending(false)
      }
    }
  }
  const closeAfterSavingRef = useRef(closeAfterSaving)
  closeAfterSavingRef.current = closeAfterSaving

  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void listen('journal-close-requested', () => { void closeAfterSavingRef.current() })
      .then(async stop => {
        if (disposed) { stop(); return }
        unlisten = stop
        await invoke('enable_journal_close_guard')
      })
      .catch(error => setErrorReport(makeUiErrorReport('enable safe closing', error)))
    return () => { disposed = true; unlisten?.() }
  }, [])

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
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(recentFiles))
  }, [recentFiles])

  useEffect(() => {
    const preserveDraft = () => {
      // Keep an offered recovery draft intact until the user has chosen what
      // to do with it; backgrounding the window must not replace that copy.
      if (editingModeRef.current === 'editing' && !fileActionPendingRef.current && !recoveryDraftRef.current) {
        void documentBackend.persistDraft(getLatestHtml()).catch(error => {
          setErrorReport(makeUiErrorReport('preserve background draft', error))
        })
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') preserveDraft()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', preserveDraft)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', preserveDraft)
    }
  }, [])

  useEffect(() => () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
  }, [])

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

  const librarySignatureRef = useRef('')
  const updateMetrics = useCallback((snapshot: EditorSnapshot) => {
    setTodayWords(snapshot.todayWords)
    setTotalWords(snapshot.yearWords)
    // Ordinary typing does not change the library. Avoid rebuilding its date
    // groups (and rerendering all its buttons) unless a heading actually changes.
    const signature = JSON.stringify(snapshot.entries.map(entry => entry.heading))
    if (signature !== librarySignatureRef.current) {
      librarySignatureRef.current = signature
      setMonthGroups(groupEntriesByMonth(snapshot.entries))
    }
  }, [])

  const handleMainSnapshot = useCallback((snapshot: EditorSnapshot) => {
    if (!focusSessionRef.current) updateMetrics(snapshot)
  }, [updateMetrics])

  const handleChange = useCallback((value: string, snapshot?: EditorSnapshot) => {
    if (editingModeRef.current !== 'editing' || fileActionPendingRef.current || recoveryDraftRef.current) return

    // Update the ref straight away as well as React state. The focus panel can
    // produce several quick edits before React has finished re-rendering.
    htmlRef.current = value
    // While Focus is open, leave the hidden main editor's document alone.
    // Its one refresh happens when Focus closes, never during focused typing.
    if (!focusSessionRef.current) setHtml(value)
    if (snapshot) updateMetrics(snapshot)
    setSaveState('unsaved')

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    if (developmentReminderPreview !== null) return
    autosaveTimer.current = setTimeout(async () => {
      if (editingModeRef.current !== 'editing') return
      setSaveState('saving')
      const result = await documentBackend.save(value)
      if (result.status === 'saved') {
        handleSaved(result, value)
      } else {
        await handleSaveFailure(result)
      }
    }, AUTOSAVE_DELAY)
  }, [])

  async function changeFile(operation: string, chooseFile: () => Promise<JournalRevision | null>) {
    if (fileActionPendingRef.current) return
    // Flush the editor before the file picker opens, so a delayed autosave
    // cannot accidentally send the previous journal's text to the next file.
    const latestHtml = getLatestHtml()
    fileActionPendingRef.current = true
    setFileActionPending(true)
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    try {
      if (documentBackend.hasOpenDocument() && editingModeRef.current === 'editing') {
        const result = await documentBackend.save(latestHtml)
        if (result.status !== 'saved') {
          await handleSaveFailure(result)
          return
        }
        handleSaved(result, latestHtml)
      } else if (documentBackend.hasOpenDocument()) {
        await documentBackend.persistDraft(latestHtml)
        const copy = await documentBackend.createRecoveryCopy('conflict', latestHtml)
        if (!copy) throw new Error('Could not preserve the protected draft before switching files.')
      }
      const revision = await chooseFile()
      if (revision) await applyOpenedRevision(revision)
    } catch (error) {
      setErrorReport(makeUiErrorReport(operation, error))
    } finally {
      fileActionPendingRef.current = false
      setFileActionPending(false)
    }
  }

  const handleNewFile = () => changeFile('create journal file', () => documentBackend.create())
  const handleOpenFile = () => changeFile('open journal file', () => documentBackend.open())
  const handleOpenRecentFile = (path: string) => changeFile('reopen recent journal file', () => documentBackend.openAtPath(path))

  async function handleReloadFile() {
    try {
      // A protected draft may be a recovery preview or a failed save. Keep a
      // separate copy before returning to the current file on disk.
      const preserved = await documentBackend.createRecoveryCopy('conflict', getLatestHtml())
      if (!preserved) throw new Error('Could not preserve the visible draft. The journal has not been reloaded.')
      const revision = await documentBackend.read()
      if (revision) applyRevision(revision, revision.conflictCount > 0 ? 'protected' : 'editing')
    } catch (error) {
      setErrorReport(makeUiErrorReport('reload journal file', error))
    }
  }

  const openFocusForDate = useCallback((date: Date) => {
    const snapshot = editorBridgeRef.current?.getSnapshot()
    if (!snapshot) return
    const session = createFocusSession(snapshot, date)
    if (!session) return
    htmlRef.current = snapshot.html
    setHtml(snapshot.html)
    focusSessionRef.current = session
    setActiveEntryDate(date)
    setFocusDate(date)
  }, [])

  function closeFocus() {
    // FocusView flushes its last keystrokes before this callback. Preserve the
    // complete composed journal, then refresh the main editor exactly once.
    setHtml(htmlRef.current)
    focusSessionRef.current = null
    focusBridgeRef.current = null
    setFocusDate(null)
  }

  const handleNewDay = useCallback(() => {
    const today = new Date()
    const latestHtml = getLatestHtml()

    // Today remains the fast navigation action: create a missing section, then
    // bring the full journal editor down to that entry rather than opening focus.
    if (!hasEntryForDate(latestHtml, today) && editingModeRef.current === 'editing') {
      handleChange(appendDateHeading(latestHtml, today))
    } else {
      htmlRef.current = latestHtml
      setHtml(latestHtml)
    }

    setActiveEntryDate(today)
    requestAnimationFrame(() => setScrollToDate(today))
  }, [handleChange])

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

  const handleFocusChange = useCallback((_entryHtml: string, snapshot: EditorSnapshot) => {
    const session = focusSessionRef.current
    if (!session || editingModeRef.current !== 'editing') return
    const combined = summarizeBlocks([...session.before, ...snapshot.blocks, ...session.after])
    handleChange(combined.html, combined)
  }, [handleChange])

  // Cmd+S save
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (!documentBackend.hasOpenDocument() || editingModeRef.current !== 'editing' || fileActionPendingRef.current) return
        if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
        setSaveState('saving')
        const latest = getLatestHtml()
        const result = await documentBackend.save(latest)
        if (result.status === 'saved') handleSaved(result, latest)
        else await handleSaveFailure(result)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="app">
      {/* The background field is intentionally non-interactive. It provides the
          RAMA drafting marks around the journal without getting in the way. */}
      <div className="rama-art-field" aria-hidden="true" />
      <main className={`journal-shell${libraryCollapsed ? ' library-collapsed' : ' library-expanded'}`}>
        <Toolbar
          onNewDay={handleNewDay}
          onFocusCurrent={() => {
            if (activeEntryDate) openFocusForDate(activeEntryDate)
          }}
          focusAvailable={activeEntryDate !== null}
          onNewFile={handleNewFile}
          onOpenFile={handleOpenFile}
          protectedDraft={editingMode === 'protected'}
          onReloadFile={handleReloadFile}
          fileActionPending={fileActionPending}
          saveState={saveState}
          todayWords={todayWords}
          totalWords={totalWords}
          typewriterMode={typewriterMode}
          onToggleTypewriter={() => setTypewriterMode(t => !t)}
          theme={theme}
          onCycleTheme={cycleTheme}
          fileOpen={fileOpen}
        />
        <div className={`layout${fileOpen ? ' layout-with-editor' : ''}`}>
          {fileOpen ? (
            <Editor
              key={documentGeneration}
              value={html}
              onError={error => setErrorReport(makeUiErrorReport('edit journal content', error))}
              onChange={handleChange}
              onSnapshot={handleMainSnapshot}
              suspended={focusDate !== null}
              editable={editingMode === 'editing' && !fileActionPending && !recoveryDraft && !focusDate}
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
          <RightLibraryPanel
            groups={monthGroups}
            onJumpToDate={handleJumpToDate}
            collapsed={libraryCollapsed}
            onCollapsedChange={setLibraryCollapsed}
          />
        </div>
      </main>
      {focusDate && (
        <FocusView
          key={`${documentGeneration}-${focusDate.getTime()}`}
          onBridgeReady={bridge => { focusBridgeRef.current = bridge }}
          onError={error => setErrorReport(makeUiErrorReport('edit journal content', error))}
          date={focusDate}
          value={focusSessionRef.current?.initialHtml ?? '<p></p>'}
          onChange={handleFocusChange}
          editable={editingMode === 'editing' && !fileActionPending && !recoveryDraft}
          onClose={closeFocus}
        />
      )}
      {errorReport && (
        <ErrorReportDialog
          report={errorReport}
          onClose={() => setErrorReport(null)}
        />
      )}
      {recoveryDraft && (
        <RecoveryDialog
          path={recoveryDraft.path}
          onKeepCurrent={() => setRecoveryDraft(null)}
          onPreview={() => {
            const recoveredHtml = getEditorHtml(recoveryDraft.fullHtml)
            htmlRef.current = recoveredHtml
            setHtml(recoveredHtml)
            editingModeRef.current = 'protected'
            setEditingMode('protected')
            setFocusDate(null)
            focusSessionRef.current = null
            focusBridgeRef.current = null
            setDocumentGeneration(value => value + 1)
            setRecoveryDraft(null)
          }}
          onSaveCopy={() => {
            void documentBackend.exportRecoveryCopy(recoveryDraft.fullHtml)
              .then(path => { if (path) setRecoveryDraft(null) })
              .catch((error) => setErrorReport(makeUiErrorReport('save recovered journal copy', error)))
          }}
        />
      )}
    </div>
  )
}
