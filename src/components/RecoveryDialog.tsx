type Props = {
  path: string
  onPreview: () => void
  onSaveCopy: () => void
  onKeepCurrent: () => void
}

export default function RecoveryDialog({ path, onPreview, onSaveCopy, onKeepCurrent }: Props) {
  return (
    <div className="error-report-overlay" role="presentation">
      <section className="error-report-dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
        <header>
          <div>
            <div className="error-report-kicker">recovery available</div>
            <h2 id="recovery-title">an unsaved draft was preserved</h2>
          </div>
        </header>
        <p>
          The journal itself has not been overwritten. You can preview the local
          draft or save it as a separate HTML file before continuing.
        </p>
        <pre>{path}</pre>
        <div className="error-report-actions">
          <button type="button" onClick={onKeepCurrent}>keep current journal</button>
          <button type="button" onClick={onPreview}>preview recovered draft</button>
          <button type="button" onClick={onSaveCopy}>save separate copy</button>
        </div>
      </section>
    </div>
  )
}
