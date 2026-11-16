import { KeyboardEvent, useEffect, useRef, useState } from 'react'

export type DailyReminder = {
  id: string
  text: string
  done: boolean
}

type Props = {
  date: Date
  items: DailyReminder[]
  top: number
  onChange: (items: DailyReminder[]) => void
}

function makeReminderId(): string {
  // The date-and-random combination is simple, local, and distinct enough for
  // these small daily lists. It does not send anything outside the journal.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function getSmallDateLabel(date: Date): string {
  return date.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).toLowerCase()
}

function getLocalDateValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function DailyReminders({ date, items, top, onChange }: Props) {
  const [draft, setDraft] = useState('')
  const draftInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // A half-written draft should not follow the user into another day's card.
    // Committed reminders are already stored in that day's heading.
    setDraft('')
  }, [date.getTime()])

  function commitDraft() {
    const text = draft.trim()
    if (!text) return

    onChange([...items, { id: makeReminderId(), text, done: false }])
    setDraft('')
    requestAnimationFrame(() => resizeTextArea(draftInputRef.current))
  }

  function updateItem(id: string, changes: Partial<DailyReminder>) {
    onChange(items.map((item) => item.id === id ? { ...item, ...changes } : item))
  }

  function resizeTextArea(textArea: HTMLTextAreaElement | null) {
    if (!textArea) return

    // Let a longer reminder wrap onto a few lines while keeping short points
    // as compact as a normal single-line field.
    textArea.style.height = 'auto'
    textArea.style.height = `${Math.min(textArea.scrollHeight, 82)}px`
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    commitDraft()

    // Keep the small input ready for another thought without requiring an
    // extra click after each dot point.
    requestAnimationFrame(() => draftInputRef.current?.focus())
  }

  return (
    <aside
      className="daily-reminders-card"
      style={{ top }}
      aria-label={`daily reminders for ${getSmallDateLabel(date)}`}
    >
      <header className="daily-reminders-header">
        <span>reminders</span>
        <time dateTime={getLocalDateValue(date)}>{getSmallDateLabel(date)}</time>
      </header>

      <div className="daily-reminders-list">
        {items.map((item) => (
          <div className={`daily-reminder-row${item.done ? ' is-done' : ''}`} key={item.id}>
            <button
              type="button"
              className="daily-reminder-check"
              onClick={() => updateItem(item.id, { done: !item.done })}
              aria-label={item.done ? `mark ${item.text} unfinished` : `mark ${item.text} done`}
              aria-pressed={item.done}
            >
              {item.done ? '✓' : ''}
            </button>
            <textarea
              ref={resizeTextArea}
              rows={1}
              value={item.text}
              onChange={(event) => {
                resizeTextArea(event.currentTarget)
                updateItem(item.id, { text: event.target.value })
              }}
              aria-label="reminder text"
            />
            <button
              type="button"
              className="daily-reminder-remove"
              onClick={() => onChange(items.filter((candidate) => candidate.id !== item.id))}
              aria-label={`remove ${item.text || 'reminder'}`}
              title="remove reminder"
            >
              ×
            </button>
          </div>
        ))}

        <div className="daily-reminder-row daily-reminder-new">
          <span className="daily-reminder-bullet" aria-hidden="true">•</span>
          <textarea
            ref={draftInputRef}
            rows={1}
            value={draft}
            onChange={(event) => {
              resizeTextArea(event.currentTarget)
              setDraft(event.target.value)
            }}
            onKeyDown={handleDraftKeyDown}
            onBlur={commitDraft}
            placeholder={items.length === 0 ? 'jot something down' : 'another reminder'}
            aria-label="new daily reminder"
          />
        </div>
      </div>
    </aside>
  )
}
