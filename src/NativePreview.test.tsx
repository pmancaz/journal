// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, Root } from 'react-dom/client'
import NativePreview from './NativePreview'

const pending = vi.hoisted(() => ({ html: null as string | null, callbacks: [] as any[] }))
vi.mock('./components/Editor', async () => {
  const React = await import('react')
  return { default: (props: any) => {
    React.useEffect(() => {
      pending.callbacks.push(props)
      props.onBridgeReady({ getLatestHtml: () => {
        if (pending.html !== null) { const html = pending.html; pending.html = null; props.onChange(html, { words: 3 }); return html }
        return props.value
      } })
      return () => props.onBridgeReady(null)
    }, [])
    return <div />
  } }
})
let root: Root | undefined
afterEach(async () => { if (root) await act(async () => root!.unmount()); document.body.innerHTML = ''; pending.html = null; pending.callbacks = []; vi.useRealTimers() })
async function mount() {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement('div'); document.body.append(el); root = createRoot(el)
  await act(async () => root!.render(<NativePreview />))
}
it('flushes an unreported final keystroke when switching entries and preserves the other entry and HTML shell', async () => {
  await mount()
  const original = '<!doctype html><html><head><title>Keep this title</title></head><body><h2 data-daily-reminders="[]">2026-11-01 Sunday</h2><p>Older untouched entry</p><h2>2026-11-02 Monday</h2><p>Latest entry</p></body></html>'
  await act(async () => window.journalNative.load(original))
  pending.html = '<p>Latest entry plus final characters</p>'
  await act(async () => window.journalNative.select('entry-0'))
  const saved = window.journalNative.snapshot()
  expect(saved).toContain('<title>Keep this title</title>')
  expect(saved).toContain('Older untouched entry')
  expect(saved).toContain('Latest entry plus final characters')
  expect(saved).toContain('data-daily-reminders="[]"')
})
it('keeps unedited diagram source verbatim and allows an empty journal to open after a populated one', async () => {
  await mount()
  const diagram = '<figure data-journal-diagram="{&quot;version&quot;:1}"><img src="data:image/png;base64,AA=="></figure>'
  await act(async () => window.journalNative.load('<html><body><h2>2026-11-01 Sunday</h2>'+diagram+'<h2>2026-11-02 Monday</h2><p>Today</p></body></html>'))
  expect(window.journalNative.snapshot()).toContain('data-journal-diagram="{&quot;version&quot;:1}"')
  await act(async () => window.journalNative.load('<html><head><title>Empty</title></head><body></body></html>'))
  expect(window.journalNative.snapshot()).toBe('<html><head><title>Empty</title></head><body></body></html>')
})
it('adds a past note at the right date and safely keeps literal pasted markup as text', async () => {
  await mount()
  await act(async () => window.journalNative.load('<html><body><h2>2026-10-29 Thursday</h2><p>Existing Thursday</p><h2>2026-11-02 Monday</h2><p>Current day</p></body></html>'))
  pending.html = '<p>Current day with final unsynced words</p>'
  await act(async () => window.journalNative.appendText('2026-10-31', 'First paragraph.\n\nLiteral <script>alert(1)</script>.'))
  const saved = window.journalNative.snapshot()
  expect(saved).toContain('Existing Thursday')
  expect(saved).toContain('Current day with final unsynced words')
  expect(saved.indexOf('2026-10-31 Saturday')).toBeLessThan(saved.indexOf('2026-11-02 Monday'))
  expect(saved).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(saved).not.toContain('<script>')
})
it('appends to an existing dated entry without replacing it or creating a duplicate heading', async () => {
  await mount()
  await act(async () => window.journalNative.load('<html><body><h2>2026-10-31 Saturday</h2><p>Original writing.</p></body></html>'))
  await act(async () => window.journalNative.appendText('2026-10-31', 'Text from Notes.'))
  const saved = window.journalNative.snapshot()
  expect(saved).toContain('Original writing.')
  expect(saved).toContain('Text from Notes.')
  expect(saved.match(/<h2>/g)).toHaveLength(1)
  expect(() => window.journalNative.appendText('2026-02-31', 'Invalid date')).toThrow()
})
it('ignores stale editor callbacks after switching days without losing the new editor bridge', async () => {
  await mount()
  await act(async () => window.journalNative.load('<html><body><h2>2026-11-01 Sunday</h2><p>Earlier day</p><h2>2026-11-02 Monday</h2><p>Later day</p></body></html>'))
  const old = pending.callbacks[pending.callbacks.length - 1]
  await act(async () => window.journalNative.select('entry-0'))
  old.onChange('<p>Stale old editor</p>', { words: 3 })
  old.onBridgeReady(null)
  pending.html = '<p>Earlier day plus immediate typing</p>'
  const saved = window.journalNative.snapshot()
  expect(saved).toContain('Earlier day plus immediate typing')
  expect(saved).toContain('Later day')
  expect(saved).not.toContain('Stale old editor')
})
it('inserts today before future-dated entries and does not change selection for an invalid ID', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 6))
  await mount()
  await act(async () => window.journalNative.load('<html><body><h2>2026-11-01 Sunday</h2><p>Earlier day</p><h2>2026-11-10 Tuesday</h2><p>Future plan</p></body></html>'))
  await act(async () => window.journalNative.today())
  const saved = window.journalNative.snapshot()
  expect(saved.indexOf('2026-11-06 Friday')).toBeLessThan(saved.indexOf('2026-11-10 Tuesday'))
  await act(async () => window.journalNative.select('does-not-exist'))
  pending.html = '<p>Still today</p>'
  expect(window.journalNative.snapshot()).toContain('<h2>2026-11-06 Friday</h2><p>Still today</p>')
})
it('gives multiple past notes independent IDs even when created in the same millisecond', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 6))
  await mount()
  await act(async () => window.journalNative.load('<html><body><h2>2026-11-06 Friday</h2><p>Today</p></body></html>'))
  let first!: string; let second!: string
  await act(async () => { first = window.journalNative.appendText('2026-11-01', 'First note') })
  await act(async () => { second = window.journalNative.appendText('2026-11-02', 'Second note') })
  expect(first).not.toBe(second)
  pending.html = '<p>Edited second note</p>'
  const saved = window.journalNative.snapshot()
  expect(saved).toContain('First note')
  expect(saved).toContain('Edited second note')
})
