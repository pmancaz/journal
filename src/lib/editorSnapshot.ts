import { DOMSerializer, Node as ProseMirrorNode } from '@tiptap/pm/model'
import { isSameDay, parseHeadingDate } from './dates'
import { JournalEntry } from './journal'
import { countWords } from './wordCount'

export type JournalBlock = {
  html: string
  heading: string
  date: Date | null
  words: number
}

export type EditorSnapshot = {
  html: string
  blocks: JournalBlock[]
  entries: JournalEntry[]
  todayWords: number
  yearWords: number
  words: number
}

// ProseMirror keeps unchanged paragraphs as the same immutable objects. Cache
// their HTML and word counts so typing in one paragraph only converts that
// paragraph, instead of rebuilding thousands of DOM elements every 250 ms.
// WeakMap lets deleted paragraphs disappear from memory when Undo releases them.
export class EditorSnapshotCache {
  private blocks = new WeakMap<ProseMirrorNode, JournalBlock>()
  private previousDoc: ProseMirrorNode | null = null
  private previousDay = ''
  private previousSnapshot: EditorSnapshot | null = null

  read(doc: ProseMirrorNode, today = new Date()): EditorSnapshot {
    const day = today.toDateString()
    if (doc === this.previousDoc && day === this.previousDay && this.previousSnapshot) {
      return this.previousSnapshot
    }
    const serializer = DOMSerializer.fromSchema(doc.type.schema)
    const blocks: JournalBlock[] = []
    doc.forEach(node => {
      let block = this.blocks.get(node)
      if (!block) {
        const container = document.createElement('div')
        container.appendChild(serializer.serializeNode(node))
        const heading = node.type.name === 'heading' && node.attrs.level === 2 ? node.textContent.trim() : ''
        block = {
          html: container.innerHTML,
          heading,
          date: heading ? parseHeadingDate(heading) : null,
          // Separate nested paragraphs/list items as words, just like visible
          // lines. Heading reminder attributes are never part of the count.
          words: countWords(node.isLeaf ? '' : node.textBetween(0, node.content.size, ' ', ' ')),
        }
        this.blocks.set(node, block)
      }
      blocks.push(block)
    })
    this.previousDoc = doc
    this.previousDay = day
    this.previousSnapshot = summarizeBlocks(blocks, today)
    return this.previousSnapshot
  }
}

export function summarizeBlocks(blocks: JournalBlock[], today = new Date()): EditorSnapshot {
  const entries: JournalEntry[] = []
  let entryDate: Date | null = null
  let todayWords = 0
  let yearWords = 0
  let words = 0
  for (const block of blocks) {
    words += block.words
    if (block.date) {
      entryDate = block.date
      entries.push({ date: block.date, heading: block.heading })
    } else if (entryDate) {
      if (isSameDay(entryDate, today)) todayWords += block.words
      if (entryDate.getFullYear() === today.getFullYear()) yearWords += block.words
    }
  }
  return { html: blocks.map(block => block.html).join(''), blocks, entries, todayWords, yearWords, words }
}

export type FocusSession = {
  before: JournalBlock[]
  after: JournalBlock[]
  initialHtml: string
  prefixHtml: string
  suffixHtml: string
}

export function createFocusSession(snapshot: EditorSnapshot, date: Date): FocusSession | null {
  const start = snapshot.blocks.findIndex(block => block.date && isSameDay(block.date, date))
  if (start < 0) return null
  let end = start + 1
  while (end < snapshot.blocks.length && !snapshot.blocks[end].date) end++
  const before = snapshot.blocks.slice(0, start + 1)
  const after = snapshot.blocks.slice(end)
  // The dated heading (including reminders) and other entries stay untouched.
  // Focus edits only its own body; the main editor is refreshed once on close.
  return {
    before, after,
    initialHtml: snapshot.blocks.slice(start + 1, end).map(block => block.html).join('') || '<p></p>',
    prefixHtml: before.map(block => block.html).join(''),
    suffixHtml: after.map(block => block.html).join(''),
  }
}
