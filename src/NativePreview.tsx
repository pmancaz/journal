import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Editor, { EditorBridge } from './components/Editor'
import { getEditorHtml, replaceEditorHtml } from './lib/journalDocument'
import { formatJournalDate, parseHeadingDate } from './lib/dates'
import './styles/globals.css'
import './native-preview.css'

type Entry = { id: string; date: string; heading: string; body: string; words: number; preview: string }
declare global { interface Window { journalNative: any; webkit?: { messageHandlers: { journal: { postMessage: (message: any) => void } } } } }
function send(message: any) { window.webkit?.messageHandlers.journal.postMessage(message) }
function textOf(html: string) { const doc = new DOMParser().parseFromString(html, 'text/html'); doc.body.querySelectorAll('p,li,h1,h2,h3,blockquote,br').forEach(el => el.append(' ')); return doc.body.textContent || '' }
function words(text: string) { return text.trim().split(/\s+/).filter(Boolean).length }
export default function NativePreview() {
  useEffect(() => { send({ type: 'ready' }) }, [])
  const all = useRef<Entry[]>([])
  const original = useRef('')
  const active = useRef('')
  const bridge = useRef<EditorBridge | null>(null)
  const dirty = useRef(false)
  const generation = useRef(0)
  const [view, setView] = useState({ id: '', html: '<p></p>', serial: 0 })
  const [typewriter, setTypewriter] = useState(false)
  const entry = () => all.current.find(e => e.id === active.current)
  const flush = () => {
    if (!bridge.current || !entry()) return
    // Read even before the editor's 250 ms notification: switching entries or
    // quitting immediately after a keystroke must retain the final characters.
    const html = bridge.current.getLatestHtml()
    if (dirty.current) entry()!.body = html
  }
  const publish = (changed = false) => {
    const current = entry()
    send({ type: 'state', changed, selected: active.current, entries: all.current.map(e => ({ id: e.id, date: e.date, words: e.words, preview: e.preview })), words: current?.words || 0 })
  }
  const choose = (id: string) => {
    const e = all.current.find(value => value.id === id)
    if (!e || active.current === id) return
    flush()
    active.current = id
    bridge.current = null
    dirty.current = false
    const serial = ++generation.current
    setView({ id, html: e.body || '<p></p>', serial })
    publish()
  }
  const onReady = useCallback((value: EditorBridge | null) => {
    if (view.serial === generation.current && view.id === active.current) bridge.current = value
  }, [view.id, view.serial])
  window.journalNative = {
    load(html: string) {
      original.current = html
      const doc = new DOMParser().parseFromString(getEditorHtml(html), 'text/html')
      const items: Entry[] = []
      let current: Entry | null = null
      for (const node of Array.from(doc.body.childNodes)) {
        const element = node as HTMLElement
        const date = element.tagName === 'H2' ? parseHeadingDate(element.textContent || '') : null
        const serialized = node.nodeType === Node.ELEMENT_NODE ? element.outerHTML : new XMLSerializer().serializeToString(node)
        if (date) {
          current = { id: `entry-${items.length}`, date: `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`, heading: serialized, body: '', words: 0, preview: '' }
          items.push(current)
        } else {
          if (!current) { current = { id: 'undated', date: '', heading: '', body: '', words: 0, preview: '' }; items.push(current) }
          current.body += serialized
        }
      }
      const meaningful = items.filter(e => e.date || e.body.trim())
      if (!meaningful.length) meaningful.push({ id: 'undated', date: '', heading: '', body: '', words: 0, preview: '' })
      meaningful.forEach(e => { const text = textOf(e.body); e.words = words(text); e.preview = text.trim().replace(/\s+/g, ' ').slice(0, 100) })
      all.current = meaningful
      active.current = ''
      bridge.current = null
      choose([...meaningful].sort((a,b) => b.date.localeCompare(a.date))[0]?.id || '')
      send({ type: 'loaded' })
    },
    select: choose,
    snapshot() { flush(); return replaceEditorHtml(original.current, all.current.map(e => e.heading + e.body).join('')) },
    command(command: string) { bridge.current?.runNativeCommand?.(command) },
    typewriter(enabled: boolean) { setTypewriter(enabled) },
    appendText(date: string, text: string) {
      const parsed = parseHeadingDate(date)
      if (!parsed || formatJournalDate(parsed).slice(0, 10) !== date) throw new Error('Choose a valid date.')
      if (!text.trim()) throw new Error('Paste or write some text first.')
      flush()
      const html = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(paragraph => {
        const p = document.createElement('p')
        paragraph.split('\n').forEach((line, index) => { if (index) p.appendChild(document.createElement('br')); p.appendChild(document.createTextNode(line)) })
        return p.outerHTML
      }).join('')
      let target = [...all.current].reverse().find(e => e.date === date)
      if (target) target.body += '<p></p>' + html
      else {
        target = { id: `pasted-${Date.now()}-${generation.current}`, date, heading: `<h2>${formatJournalDate(parsed)}</h2>`, body: html, words: 0, preview: '' }
        const position = all.current.findIndex(e => e.date && e.date > date)
        if (position < 0) all.current.push(target)
        else all.current.splice(position, 0, target)
      }
      const textValue = textOf(target.body)
      target.words = words(textValue); target.preview = textValue.trim().replace(/\s+/g, ' ').slice(0, 100)
      // The old editor must not overwrite the appended body during its remount.
      bridge.current = null; active.current = ''; dirty.current = false
      choose(target.id); publish(true)
      return target.id
    },
    today() {
      const now = new Date(); const heading = formatJournalDate(now); const date = heading.slice(0,10)
      const existing = [...all.current].reverse().find(e => e.date === date)
      if (existing) { choose(existing.id); bridge.current?.runNativeCommand?.('focus'); return }
      flush()
      const e = { id: `new-${Date.now()}-${generation.current}`, date, heading: `<h2>${heading}</h2>`, body: '<p></p>', words: 0, preview: '' }
      const position = all.current.findIndex(entry => entry.date && entry.date > date)
      if (position < 0) all.current.push(e)
      else all.current.splice(position, 0, e)
      choose(e.id); publish(true)
    },
  }
  return <Editor key={view.serial} value={view.html} variant="focus" autoFocus={true} typewriterMode={typewriter} scrollToDate={null} onScrollToDateDone={() => {}} onBridgeReady={onReady}
    onError={error => send({ type: 'error', message: String(error) })}
    onChange={(html, snapshot) => { if (view.serial !== generation.current || view.id !== active.current) return; const e = entry(); if (!e) return; e.body = html; e.words = snapshot.words; e.preview = textOf(html).trim().replace(/\s+/g,' ').slice(0,100); dirty.current = true; publish(true) }} />
}
const mount = document.getElementById('root')
if (mount) createRoot(mount).render(<NativePreview />)
