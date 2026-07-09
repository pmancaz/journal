import { formatJournalDate, formatMonthLabel, parseHeadingDate, isSameDay } from './dates'

export type JournalEntry = {
  date: Date
  heading: string
}

export type MonthGroup = {
  monthLabel: string
  entries: JournalEntry[]
}

function parseHtmlDocument(html: string): Document {
  return new DOMParser().parseFromString(html || '<p></p>', 'text/html')
}

function getJournalHeadings(doc: Document): HTMLHeadingElement[] {
  return Array.from(doc.body.querySelectorAll('h2'))
}

export function hasEntryForDate(html: string, date: Date): boolean {
  return extractEntries(html).some((entry) => isSameDay(entry.date, date))
}

export function appendDateHeading(html: string, date: Date): string {
  const doc = parseHtmlDocument(html)

  // We add a heading plus a blank paragraph so the user lands in a ready-to-type
  // line instead of being stuck inside the heading itself.
  if (doc.body.childElementCount > 0) {
    doc.body.insertAdjacentHTML('beforeend', '<hr>')
  }

  const heading = doc.createElement('h2')
  heading.textContent = formatJournalDate(date)
  doc.body.appendChild(heading)

  const paragraph = doc.createElement('p')
  paragraph.innerHTML = '<br>'
  doc.body.appendChild(paragraph)

  return doc.body.innerHTML
}

export function getCurrentDaySection(html: string, date: Date): string {
  const doc = parseHtmlDocument(html)
  const headings = getJournalHeadings(doc)

  for (let i = 0; i < headings.length; i += 1) {
    const headingDate = parseHeadingDate(headings[i].textContent ?? '')
    if (!headingDate || !isSameDay(headingDate, date)) continue

    const sectionParts: string[] = []
    let cursor = headings[i].nextElementSibling

    while (cursor && cursor.tagName !== 'H2') {
      const text = cursor.textContent?.trim()
      if (text) sectionParts.push(text)
      cursor = cursor.nextElementSibling
    }

    return sectionParts.join(' ')
  }

  return ''
}

export function extractEntries(html: string): JournalEntry[] {
  const doc = parseHtmlDocument(html)
  const entries: JournalEntry[] = []

  for (const heading of getJournalHeadings(doc)) {
    const headingText = heading.textContent?.trim() ?? ''
    const date = parseHeadingDate(headingText)

    if (date) {
      entries.push({
        date,
        heading: headingText,
      })
    }
  }

  return entries
}

export function groupEntriesByMonth(entries: JournalEntry[]): MonthGroup[] {
  const map = new Map<string, MonthGroup>()

  for (const entry of [...entries].reverse()) {
    const label = formatMonthLabel(entry.date)
    if (!map.has(label)) {
      map.set(label, { monthLabel: label, entries: [] })
    }
    map.get(label)!.entries.push(entry)
  }

  return Array.from(map.values())
}

export function getPlainTextFromHtml(html: string): string {
  return parseHtmlDocument(html).body.textContent ?? ''
}
