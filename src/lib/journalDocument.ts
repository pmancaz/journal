export type JournalRevision = {
  fullHtml: string
  editorHtml: string
  revision: string
  modifiedAt: number
  path: string
  displayName: string
  conflictCount: number
  warning?: string | null
}

export type SaveStatus = 'saved' | 'remoteChanged' | 'conflict' | 'failed'

export type SaveResult = {
  status: SaveStatus
  revision?: JournalRevision
  report?: string
  warning?: string
  recoveryPath?: string
}

// Capture the opening tag separately: the body may be empty, or its text may
// also appear in an attribute. Neither case should change where writing goes.
const BODY_EXPRESSION = /(<body\b(?:"[^"]*"|'[^']*'|[^'">])*>)([\s\S]*?)<\/body\s*>/i
export function getEditorHtml(fullHtml: string): string {
  const match = BODY_EXPRESSION.exec(fullHtml)
  return match?.[2] ?? fullHtml
}

export function replaceEditorHtml(fullHtml: string, editorHtml: string): string {
  const match = BODY_EXPRESSION.exec(fullHtml)
  if (!match || match.index === undefined) {
    return [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1">',
      '  <title>Journal</title>',
      '</head>',
      '<body>',
      editorHtml,
      '</body>',
      '</html>',
    ].join('\n')
  }

  const bodyStart = match.index + match[1].length
  const bodyEnd = bodyStart + match[2].length
  return `${fullHtml.slice(0, bodyStart)}${editorHtml}${fullHtml.slice(bodyEnd)}`
}

// Old journals may still contain an iPad ownership tag. Remove only that tag
// from the document head when saving; the journal body and other metadata stay intact.
export function removeLegacyWriterMetadata(fullHtml: string): string {
  return fullHtml.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, (head) =>
    head.replace(/<meta\b(?=[^>]*\bname\s*=\s*(["'])pc-journal-writer\1)[^>]*>/gi, ''),
  )
}
