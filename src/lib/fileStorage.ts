import { open, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import TurndownService from 'turndown'

let filePath: string | null = null
const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
})

function wrapHtmlDocument(editorHtml: string): string {
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

function unwrapHtmlDocument(fileContents: string): string {
  // This lets the app open full HTML files while still feeding only the body
  // content into the editor.
  if (!fileContents.toLowerCase().includes('<html')) {
    return fileContents
  }

  return new DOMParser().parseFromString(fileContents, 'text/html').body.innerHTML
}

async function readHtmlAtPath(targetPath: string): Promise<string | null> {
  try {
    filePath = targetPath
    return unwrapHtmlDocument(await readTextFile(targetPath))
  } catch {
    return null
  }
}

export async function newHtmlFile(): Promise<boolean> {
  try {
    const selected = await save({
      filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
      defaultPath: 'journal.html',
    })
    if (!selected) return false
    filePath = selected as string
    await writeTextFile(filePath, wrapHtmlDocument('<p></p>'))
    return true
  } catch {
    return false
  }
}

export async function openHtmlFile(): Promise<string | null> {
  try {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
    })
    if (!selected) return null
    return await readHtmlAtPath(selected as string)
  } catch {
    return null
  }
}

export async function openHtmlFileAtPath(targetPath: string): Promise<string | null> {
  return await readHtmlAtPath(targetPath)
}

export async function readHtmlFile(): Promise<string | null> {
  if (!filePath) return null
  try {
    return unwrapHtmlDocument(await readTextFile(filePath))
  } catch {
    return null
  }
}

export async function writeHtmlFile(editorHtml: string): Promise<boolean> {
  if (!filePath) return false
  try {
    await writeTextFile(filePath, wrapHtmlDocument(editorHtml))
    return true
  } catch {
    return false
  }
}

export async function exportMarkdownFile(editorHtml: string): Promise<boolean> {
  try {
    const selected = await save({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: 'journal-export.md',
    })
    if (!selected) return false

    await writeTextFile(selected as string, turndown.turndown(editorHtml))
    return true
  } catch {
    return false
  }
}

export function hasFileOpen(): boolean {
  return filePath !== null
}

export function getOpenFilePath(): string | null {
  return filePath
}
