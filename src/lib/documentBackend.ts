import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import {
  JournalRevision,
  SaveResult,
  getEditorHtml,
  replaceEditorHtml,
  removeLegacyWriterMetadata,
} from './journalDocument'

type RawDocument = {
  fullHtml: string
  revision: string
  modifiedAt: number
  path: string
  displayName: string
  conflictCount: number
  warning?: string | null
}

type RawWriteResult = {
  status: 'saved' | 'remoteChanged' | 'failed'
  document?: RawDocument
  report?: string
}

export type RecoveryEntry = {
  path: string
  kind: 'draft' | 'snapshot' | 'conflict'
  createdAt: number
}

export type RecoveryDraft = RecoveryEntry & {
  fullHtml: string
}

export interface DocumentBackend {
  open(): Promise<JournalRevision | null>
  openAtPath(path: string): Promise<JournalRevision | null>
  create(): Promise<JournalRevision | null>
  read(): Promise<JournalRevision | null>
  save(editorHtml: string): Promise<SaveResult>
  persistDraft(editorHtml: string): Promise<string | null>
  createRecoveryCopy(kind: 'snapshot' | 'conflict', editorHtml?: string): Promise<string | null>
  listRecoverySnapshots(): Promise<RecoveryEntry[]>
  readLatestDraft(): Promise<RecoveryDraft | null>
  exportRecoveryCopy(fullHtml: string): Promise<string | null>
  hasOpenDocument(): boolean
  getOpenPath(): string | null
  getSessionId(): string
}

const sessionId = crypto.randomUUID()

function deviceLabel(): string {
  return navigator.platform.includes('Mac') ? 'Patrick’s Mac' : navigator.platform
}

function toRevision(raw: RawDocument): JournalRevision {
  return {
    ...raw,
    editorHtml: getEditorHtml(raw.fullHtml),
  }
}

async function rawOpen(): Promise<RawDocument | null> {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
  })
  if (!selected) return null
  return invoke<RawDocument>('read_journal_document', { path: selected as string })
}

async function rawOpenAtPath(path: string): Promise<RawDocument | null> {
  return invoke<RawDocument>('read_journal_document', { path })
}

async function rawCreate(): Promise<RawDocument | null> {
  const initialHtml = replaceEditorHtml('', '<p></p>')

  const selected = await save({
    filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
    defaultPath: 'journal.html',
  })
  if (!selected) return null
  return invoke<RawDocument>('create_journal_document', {
    path: selected as string,
    fullHtml: initialHtml,
  })
}

async function rawRead(path: string): Promise<RawDocument> {
  return invoke<RawDocument>('read_journal_document', { path })
}

async function rawGuardedWrite(
  path: string,
  expectedRevision: string,
  fullHtml: string,
): Promise<RawWriteResult> {
  return invoke<RawWriteResult>('guarded_write_journal', { path, expectedRevision, fullHtml })
}

async function rawRecovery(
  path: string,
  kind: 'draft' | 'snapshot' | 'conflict',
  fullHtml: string,
): Promise<string> {
  return invoke<string>('write_journal_recovery', { documentPath: path, kind, fullHtml })
}

async function rawListRecovery(path: string): Promise<RecoveryEntry[]> {
  return invoke<RecoveryEntry[]>('list_journal_recovery', { documentPath: path })
}

async function rawLatestDraft(path: string): Promise<RecoveryDraft | null> {
  return invoke<RecoveryDraft | null>('read_latest_journal_draft', { documentPath: path })
}

async function rawExportRecovery(fullHtml: string): Promise<string | null> {
  const selected = await save({
    filters: [{ name: 'HTML recovery copy', extensions: ['html'] }],
    defaultPath: 'journal-recovered-copy.html',
  })
  if (!selected) return null
  await invoke('create_journal_document', { path: selected as string, fullHtml })
  return selected as string
}

class GuardedDocumentBackend implements DocumentBackend {
  private current: JournalRevision | null = null
  private saveInFlight: Promise<SaveResult> | null = null
  private queuedEditorHtml: string | null = null
  private draftWrites: Promise<unknown> = Promise.resolve()
  private firstSessionSnapshotMade = false
  private lastSnapshotAt = 0

  private accept(raw: RawDocument): JournalRevision {
    const revision = toRevision(raw)
    this.current = revision
    return revision
  }

  async open(): Promise<JournalRevision | null> {
    const raw = await rawOpen()
    this.firstSessionSnapshotMade = false
    return raw ? this.accept(raw) : null
  }

  async openAtPath(path: string): Promise<JournalRevision | null> {
    const raw = await rawOpenAtPath(path)
    this.firstSessionSnapshotMade = false
    return raw ? this.accept(raw) : null
  }

  async create(): Promise<JournalRevision | null> {
    const raw = await rawCreate()
    this.firstSessionSnapshotMade = false
    return raw ? this.accept(raw) : null
  }

  async read(): Promise<JournalRevision | null> {
    if (!this.current) return null
    return this.accept(await rawRead(this.current.path))
  }

  async save(editorHtml: string): Promise<SaveResult> {
    this.queuedEditorHtml = editorHtml

    // Only one full-document write may run at once. If more typing arrives,
    // queuedEditorHtml is replaced and the newest value is written next.
    if (this.saveInFlight) return this.saveInFlight
    this.saveInFlight = this.drainSaveQueue()
    try {
      return await this.saveInFlight
    } finally {
      // A failed native request must not leave every later save waiting on it.
      this.saveInFlight = null
    }
  }

  private async drainSaveQueue(): Promise<SaveResult> {
    let result: SaveResult = this.failure('save journal', 'No journal is open.')

    while (this.queuedEditorHtml !== null) {
      const editorHtml = this.queuedEditorHtml
      this.queuedEditorHtml = null
      let draftWarning: string | undefined
      try {
        await this.persistDraft(editorHtml)
      } catch (error) {
        // A backup failure does not prevent saving the actual journal, but
        // it must be reported rather than silently claiming full protection.
        draftWarning = this.report('preserve recovery draft', String(error))
      }
      try {
        result = await this.saveOnce(editorHtml)
      } catch (error) {
        result = this.failure('save journal', String(error))
      }
      if (draftWarning) result.warning = [result.warning, draftWarning].filter(Boolean).join('\n\n')
      if (result.status !== 'saved') {
        // A conflict stops journal writes, not recovery writes. Keep draining
        // newer queued text into recovery until the newest request is safe.
        while (this.queuedEditorHtml !== null) {
          const newest = this.queuedEditorHtml
          this.queuedEditorHtml = null
          try {
            await this.persistDraft(newest)
          } catch (error) {
            result.report = [result.report, this.report('preserve newest draft', String(error))].filter(Boolean).join('\n\n')
          }
          try {
            result.recoveryPath = await this.createRecoveryCopy('conflict', newest) ?? undefined
          } catch (error) {
            result.report = [result.report, this.report('preserve newest draft', String(error))].filter(Boolean).join('\n\n')
          }
        }
        break
      }
    }
    return result
  }

  private async saveOnce(editorHtml: string): Promise<SaveResult> {
    if (!this.current) return this.failure('save journal', 'No journal is open.')
    let warning: string | undefined
    if (!this.firstSessionSnapshotMade || Date.now() - this.lastSnapshotAt >= 5 * 60 * 1000) {
      try {
        await this.createRecoveryCopy('snapshot', this.current.editorHtml)
      } catch (error) {
        warning = this.report('preserve recovery snapshot', String(error))
      }
    }

    // Mac editing has no ownership or expiry. Older handoff metadata is
    // retired on the next normal save, without changing the writing itself.
    const nextFullHtml = removeLegacyWriterMetadata(replaceEditorHtml(this.current.fullHtml, editorHtml))
    const { raw: result, handled } = await this.performGuardedWrite(
      this.current.path,
      this.current.revision,
      nextFullHtml,
      'save journal',
    )

    if (result.status === 'remoteChanged') {
      try {
        const recoveryPath = await this.createRecoveryCopy('conflict', editorHtml)
        return { ...handled, warning, recoveryPath: recoveryPath ?? undefined }
      } catch (error) {
        return { ...handled, warning, report: `${handled.report}\n\n${this.report('preserve conflict copy', String(error))}` }
      }
    }
    return { ...handled, warning }
  }

  private async performGuardedWrite(
    path: string,
    expectedRevision: string,
    fullHtml: string,
    operation: string,
  ): Promise<{ raw: RawWriteResult; handled: SaveResult }> {
    // The native code checks the file's revision before replacing it. This
    // still protects edits made in another Mac app without any device handoff.
    const raw = await rawGuardedWrite(path, expectedRevision, fullHtml)
    return { raw, handled: this.handleRawWrite(raw, operation) }
  }

  async persistDraft(editorHtml: string): Promise<string | null> {
    if (!this.current) return null
    const path = this.current.path
    const fullHtml = replaceEditorHtml(this.current.fullHtml, editorHtml)
    // Backgrounding and autosave share the same draft file. Serialize both
    // callers so a slow earlier write cannot finish after the newest draft.
    const write = this.draftWrites.catch(() => undefined)
      .then(() => rawRecovery(path, 'draft', fullHtml))
    this.draftWrites = write
    return write
  }

  async createRecoveryCopy(
    kind: 'snapshot' | 'conflict',
    editorHtml = this.current?.editorHtml,
  ): Promise<string | null> {
    if (!this.current || editorHtml === undefined) return null
    const fullHtml = replaceEditorHtml(this.current.fullHtml, editorHtml)
    const path = await rawRecovery(this.current.path, kind, fullHtml)
    if (kind === 'snapshot') {
      this.firstSessionSnapshotMade = true
      this.lastSnapshotAt = Date.now()
    }
    return path
  }

  async listRecoverySnapshots(): Promise<RecoveryEntry[]> {
    return this.current ? rawListRecovery(this.current.path) : []
  }

  async readLatestDraft(): Promise<RecoveryDraft | null> {
    return this.current ? rawLatestDraft(this.current.path) : null
  }

  async exportRecoveryCopy(fullHtml: string): Promise<string | null> {
    return rawExportRecovery(fullHtml)
  }

  hasOpenDocument(): boolean { return this.current !== null }
  getOpenPath(): string | null { return this.current?.path ?? null }
  getSessionId(): string { return sessionId }

  private handleRawWrite(raw: RawWriteResult, operation: string): SaveResult {
    if (raw.document) this.accept(raw.document)
    if (raw.status === 'saved' && this.current) return { status: 'saved', revision: this.current }
    if (raw.status === 'remoteChanged') {
      return {
        status: raw.document?.conflictCount ? 'conflict' : 'remoteChanged',
        revision: this.current ?? undefined,
        report: raw.report ?? this.report(operation, 'The journal changed before this write could complete.'),
      }
    }
    return {
      status: 'failed',
      revision: this.current ?? undefined,
      report: raw.report ?? this.report(operation, 'The native file operation failed.'),
    }
  }

  private failure(operation: string, detail: string, status: SaveResult['status'] = 'failed'): SaveResult {
    return { status, revision: this.current ?? undefined, report: this.report(operation, detail) }
  }

  private report(operation: string, detail: string): string {
    return [
      'PC Journal error report',
      `Time: ${new Date().toISOString()}`,
      `Operation: ${operation}`,
      `File: ${this.current?.path ?? 'no file selected'}`,
      `Revision: ${this.current?.revision ?? 'none'}`,
      `Device: ${deviceLabel()}`,
      `This session: ${sessionId}`,
      '',
      detail,
    ].join('\n')
  }
}

export const documentBackend: DocumentBackend = new GuardedDocumentBackend()

export async function openExternalUrl(url: string): Promise<void> {
  const external = new URL(url)
  if (external.protocol !== 'http:' && external.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS web links can be opened.')
  }
  // The native macOS shell hosts the same editor without a Tauri runtime.
  // Hand user-activated links to its narrow, validated native message handler.
  const native = typeof window !== 'undefined' ? window.webkit?.messageHandlers?.journal : undefined
  if (native) {
    native.postMessage({ type: 'openExternal', url: external.href })
    return
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(external.href)
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}
