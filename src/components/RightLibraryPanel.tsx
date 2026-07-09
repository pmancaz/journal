import { useState } from 'react'
import { MonthGroup } from '../lib/journal'
import { formatJournalDateDisplay } from '../lib/dates'

type Props = {
  groups: MonthGroup[]
  onJumpToDate: (date: Date) => void
}

export default function RightLibraryPanel({ groups, onJumpToDate }: Props) {
  const [collapsed, setCollapsed] = useState(true)

  if (collapsed) {
    return (
      <aside className="sidebar sidebar-right sidebar-collapsed">
        <button
          className="sidebar-toggle"
          onClick={() => setCollapsed(false)}
          title="expand library"
        >
          ‹
        </button>
      </aside>
    )
  }

  return (
    <aside className="sidebar sidebar-right">
      <div className="sidebar-label sidebar-label-row">
        <span>library</span>
        <button
          className="sidebar-toggle-inline"
          onClick={() => setCollapsed(true)}
          title="collapse library"
        >
          ›
        </button>
      </div>
      <div className="library-list">
        {groups.map(group => (
          <div key={group.monthLabel} className="library-month">
            <div className="library-h1">{group.monthLabel.toLowerCase()}</div>
            {group.entries.map(entry => {
              const label = formatJournalDateDisplay(entry.date).toLowerCase()
              return (
                <button
                  key={entry.heading}
                  className="library-h2"
                  onClick={() => onJumpToDate(entry.date)}
                >
                  {label}
                </button>
              )
            })}
          </div>
        ))}
        {groups.length === 0 && (
          <div className="sidebar-empty">no entries yet</div>
        )}
      </div>
    </aside>
  )
}
