const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function formatJournalDate(date: Date): string {
  const day = DAYS[date.getDay()]
  const y = date.getFullYear()
  const m = pad2(date.getMonth() + 1)
  const d = pad2(date.getDate())
  return `${y}-${m}-${d} ${day}`
}

export function formatJournalDateDisplay(date: Date): string {
  const day = DAYS[date.getDay()]
  const y = date.getFullYear()
  const m = pad2(date.getMonth() + 1)
  const d = pad2(date.getDate())
  return `${y}-${m}-${d} ${day}`
}

export function formatMonthLabel(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

export function parseHeadingDate(heading: string): Date | null {
  // Matches current rich-text headings like "2026-05-12 Monday"
  // and older markdown-style headings from earlier versions of the app.
  const plainIso = heading.match(/^(\d{4})-(\d{2})-(\d{2})\b/)
  if (plainIso) {
    const year = parseInt(plainIso[1], 10)
    const month = parseInt(plainIso[2], 10) - 1
    const d = parseInt(plainIso[3], 10)
    return new Date(year, month, d)
  }

  const iso = heading.match(/^##\s+\*?(\d{4})-(\d{2})-(\d{2})\*?/)
  if (iso) {
    const year = parseInt(iso[1], 10)
    const month = parseInt(iso[2], 10) - 1
    const d = parseInt(iso[3], 10)
    return new Date(year, month, d)
  }
  const legacy = heading.match(/^##\s+\w+\s+(\d{1,2})\s+(\w+)\s+(\d{4})/)
  if (legacy) {
    const d = parseInt(legacy[1], 10)
    const monthIndex = MONTHS.findIndex(m => m === legacy[2])
    const year = parseInt(legacy[3], 10)
    if (monthIndex === -1) return null
    return new Date(year, monthIndex, d)
  }
  return null
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}
