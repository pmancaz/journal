import { describe, expect, it } from 'vitest'
import { getEditorHtml, replaceEditorHtml, removeLegacyWriterMetadata } from './journalDocument'

const ORIGINAL = '<!doctype html><html><head><meta charset="utf-8"><title>Private journal</title></head><body><h1>Kept heading</h1><p>Original text</p></body></html>'

describe('journal HTML shell preservation', () => {
  it('changes only the body contents', () => {
    const changed = replaceEditorHtml(ORIGINAL, '<h1>Kept heading</h1><p>New text</p>')
    expect(changed).toContain('<head><meta charset="utf-8"><title>Private journal</title></head>')
    expect(getEditorHtml(changed)).toBe('<h1>Kept heading</h1><p>New text</p>')
  })

  it('wraps an older body-only document in valid HTML', () => {
    const changed = replaceEditorHtml('<h1>Journal</h1>', '<h1>Journal</h1>')
    expect(changed).toContain('<!doctype html>')
    expect(getEditorHtml(changed).trim()).toBe('<h1>Journal</h1>')
  })
})

describe('retiring old device ownership metadata', () => {
  it.each(['expired-lease', 'active-ipad-lease', 'not-base64'])('removes %s without changing other metadata or writing', (metadata) => {
    const oldFile = ORIGINAL.replace('</head>', `<meta name="pc-journal-writer" content="${metadata}"></head>`)
    expect(removeLegacyWriterMetadata(oldFile)).toBe(ORIGINAL)
  })

  it('preserves unrelated metadata and body content', () => {
    const html = ORIGINAL.replace('</head>', "<meta content='old' name='pc-journal-writer'><meta name='author' content='Pat'></head>")
    const result = removeLegacyWriterMetadata(html)
    expect(result).toContain("<meta name='author' content='Pat'>")
    expect(getEditorHtml(result)).toBe(getEditorHtml(ORIGINAL))
  })
})

describe('HTML body boundaries', () => {
  it.each([
    '<html><head><title>Kept</title></head><body></body></html>',
    '<html><body class="x">x</body></html>',
    '<html><BODY data-label="a > b">Old</BODY></html>',
  ])('round-trips new writing inside the body: %s', source => {
    const saved = replaceEditorHtml(source, '<p>New writing</p>')
    expect(getEditorHtml(saved)).toBe('<p>New writing</p>')
    expect(saved).toBe(source.replace(/(<body\b(?:"[^"]*"|'[^']*'|[^'">])*>)[\s\S]*?(<\/body>)/i, '$1<p>New writing</p>$2'))
  })
})
