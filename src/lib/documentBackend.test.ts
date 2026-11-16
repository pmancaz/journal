import { beforeEach, describe, expect, it, vi } from 'vitest'

// The native boundary is replaced with an in-memory file. These checks never
// open or write a real journal, but exercise the actual Mac saving logic.
const native = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: native.open, save: native.save }))

const original = '<html><head><title>Journal</title></head><body><p>Original</p></body></html>'
let disk: { fullHtml: string; revision: string; path: string; displayName: string; modifiedAt: number; conflictCount: number }
let writes: string[]

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubGlobal('navigator', { platform: 'MacIntel' })
  writes = []
  disk = { fullHtml: original, revision: 'revision-0', path: '/synthetic/journal.html', displayName: 'journal.html', modifiedAt: 1, conflictCount: 0 }
  native.open.mockResolvedValue(disk.path)
  native.save.mockResolvedValue('/synthetic/new.html')
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'read_journal_document') return { ...disk }
    if (command === 'write_journal_recovery') return `/recovery/${args.kind}.html`
    if (command === 'guarded_write_journal') {
      if (args.expectedRevision !== disk.revision) return { status: 'remoteChanged', document: { ...disk } }
      writes.push(args.fullHtml)
      disk = { ...disk, fullHtml: args.fullHtml, revision: `revision-${writes.length}` }
      return { status: 'saved', document: { ...disk } }
    }
    if (command === 'create_journal_document') {
      disk = { ...disk, fullHtml: args.fullHtml, path: args.path }
      return { ...disk }
    }
    throw new Error(`Unexpected command: ${command}`)
  })
})

describe('Mac journal saving without a device handoff', () => {
  it.each([null, 'expired', 'active-ipad-session'])('saves immediately after opening with old metadata %s', async (lease) => {
    if (lease) disk.fullHtml = original.replace('</head>', `<meta name="pc-journal-writer" content="${lease}"></head>`)
    const { documentBackend } = await import('./documentBackend')
    await documentBackend.open()
    expect((await documentBackend.save('<p>Written on Mac</p>')).status).toBe('saved')
    expect(disk.fullHtml).toContain('<p>Written on Mac</p>')
    expect(disk.fullHtml).not.toContain('pc-journal-writer')
    expect(disk.fullHtml).toContain('<title>Journal</title>')
  })

  it('creates a file that can be saved immediately', async () => {
    const { documentBackend } = await import('./documentBackend')
    await documentBackend.create()
    expect((await documentBackend.save('<p>First entry</p>')).status).toBe('saved')
  })

  it('preserves a local draft and rejects an external file change', async () => {
    const { documentBackend } = await import('./documentBackend')
    await documentBackend.open()
    disk = { ...disk, revision: 'external-change', fullHtml: original.replace('Original', 'External text') }
    const result = await documentBackend.save('<p>Local unsaved text</p>')
    expect(result.status).toBe('remoteChanged')
    expect(disk.fullHtml).toContain('External text')
    expect(writes).toHaveLength(0)
    expect(result.recoveryPath).toBe('/recovery/conflict.html')
    expect(native.invoke).toHaveBeenCalledWith('write_journal_recovery', expect.objectContaining({ kind: 'conflict', fullHtml: expect.stringContaining('Local unsaved text') }))
  })

  it('saves rapid changes in order and keeps the newest text', async () => {
    const { documentBackend } = await import('./documentBackend')
    await documentBackend.open()
    const results = await Promise.all([
      documentBackend.save('<p>First</p>'),
      documentBackend.save('<p>Second</p>'),
      documentBackend.save('<p>Newest</p>'),
    ])
    expect(results.every(result => result.status === 'saved')).toBe(true)
    expect(disk.fullHtml).toContain('<p>Newest</p>')
    expect(writes).toHaveLength(2)
  })

  it('returns a copyable report after native failure and allows a later retry', async () => {
    const { documentBackend } = await import('./documentBackend')
    await documentBackend.open()
    const normalInvoke = native.invoke.getMockImplementation()!
    native.invoke.mockImplementation(async (command, args) => {
      if (command === 'guarded_write_journal') throw new Error('Disk temporarily unavailable')
      return normalInvoke(command, args)
    })
    const failure = await documentBackend.save('<p>Keep this text</p>')
    expect(failure.status).toBe('failed')
    expect(failure.report).toContain('Disk temporarily unavailable')
    native.invoke.mockImplementation(normalInvoke)
    expect((await documentBackend.save('<p>Keep this text</p>')).status).toBe('saved')
  })
})

// These failures happen between operations rather than within a single save.
// Deferred promises let the tests reproduce that timing without using disk.
describe('recovery during interrupted saves', () => {
  it('preserves the newest queued text when the running write finds a conflict', async () => {
    const { documentBackend } = await import('./documentBackend')
    await documentBackend.open()
    const normalInvoke = native.invoke.getMockImplementation()!
    let release!: () => void
    let started!: () => void
    const writing = new Promise<void>(resolve => { started = resolve })
    const pause = new Promise<void>(resolve => { release = resolve })
    native.invoke.mockImplementation(async (command, args) => {
      if (command === 'guarded_write_journal') {
        started()
        await pause
        return { status: 'remoteChanged', document: { ...disk, revision: 'external' } }
      }
      return normalInvoke(command, args)
    })
    const first = documentBackend.save('<p>Earlier</p>')
    await writing
    const newest = documentBackend.save('<p>Newest writing</p>')
    release()
    const results = await Promise.all([first, newest])
    expect(results.every(result => result.status === 'remoteChanged')).toBe(true)
    const recoveryCalls = native.invoke.mock.calls.filter(([command]) => command === 'write_journal_recovery')
    expect(recoveryCalls.filter(([, args]) => args.kind === 'draft').slice(-1)[0]?.[1].fullHtml).toContain('Newest writing')
    expect(recoveryCalls.filter(([, args]) => args.kind === 'conflict').slice(-1)[0]?.[1].fullHtml).toContain('Newest writing')
    expect(writes).toHaveLength(0)
  })

  it('reports backup failures even if the journal itself saved', async () => {
    const { documentBackend } = await import('./documentBackend')
    await documentBackend.open()
    const normalInvoke = native.invoke.getMockImplementation()!
    native.invoke.mockImplementation(async (command, args) => {
      if (command === 'write_journal_recovery') throw new Error('Recovery folder unavailable')
      return normalInvoke(command, args)
    })
    const result = await documentBackend.save('<p>New writing</p>')
    expect(result.status).toBe('saved')
    expect(result.warning).toContain('Recovery folder unavailable')
    await expect(documentBackend.persistDraft('<p>Newest</p>')).rejects.toThrow('Recovery folder unavailable')
  })

  it('orders background and autosave drafts even when the first write is slow', async () => {
    const { documentBackend } = await import('./documentBackend')
    await documentBackend.open()
    let release!: () => void
    const pause = new Promise<void>(resolve => { release = resolve })
    const normalInvoke = native.invoke.getMockImplementation()!
    const completed: string[] = []
    native.invoke.mockImplementation(async (command, args) => {
      if (command === 'write_journal_recovery' && args.kind === 'draft') {
        if (args.fullHtml.includes('Earlier')) await pause
        completed.push(args.fullHtml)
      }
      return normalInvoke(command, args)
    })
    const first = documentBackend.persistDraft('<p>Earlier</p>')
    const next = documentBackend.persistDraft('<p>Newest</p>')
    release()
    await Promise.all([first, next])
    expect(completed[0]).toContain('Earlier')
    expect(completed[1]).toContain('Newest')
  })
})
