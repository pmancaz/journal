import { useState } from 'react'
import { copyText } from '../lib/documentBackend'

type Props = {
  report: string
  onClose: () => void
}

export default function ErrorReportDialog({ report, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  async function copyErrorReport() {
    try {
      await copyText(report)
      setCopied(true)
      setCopyFailed(false)
    } catch {
      // Keep the report visible if macOS blocks clipboard access so it can
      // still be selected manually rather than disappearing with the error.
      setCopied(false)
      setCopyFailed(true)
    }
  }

  return (
    <div className="error-report-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="error-report-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-report-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <div className="error-report-kicker">journal error</div>
            <h2 id="error-report-title">something could not be completed</h2>
          </div>
          <button type="button" className="error-report-close" onClick={onClose}>close ×</button>
        </header>
        <p>The detailed report below can be copied and pasted into Codex.</p>
        <pre>{report}</pre>
        <div className="error-report-actions">
          {copyFailed && <span>copy failed — select the report above</span>}
          {copied && <span>copied</span>}
          <button type="button" onClick={copyErrorReport}>
            {copied ? 'error report copied' : 'copy error report'}
          </button>
        </div>
      </section>
    </div>
  )
}
