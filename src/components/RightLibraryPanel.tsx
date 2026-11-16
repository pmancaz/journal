import { memo, useState } from 'react'
import { MonthGroup } from '../lib/journal'
import { formatJournalDateDisplay } from '../lib/dates'

type Props = {
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  groups: MonthGroup[]
  onJumpToDate: (date: Date) => void
}

type JumpMenu = 'year' | 'month' | 'date' | null

function RightLibraryPanel({ groups, onJumpToDate, collapsed, onCollapsedChange }: Props) {
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [openMenu, setOpenMenu] = useState<JumpMenu>(null)

  const entries = groups.flatMap((group) => group.entries)
  const years = [...new Set(entries.map((entry) => entry.date.getFullYear()))]
    .sort((a, b) => b - a)
  const months = selectedYear === ''
    ? []
    : [...new Set(entries
      .filter((entry) => entry.date.getFullYear() === Number(selectedYear))
      .map((entry) => entry.date.getMonth()))]
      .sort((a, b) => b - a)
  const dates = selectedYear === '' || selectedMonth === ''
    ? []
    : entries.filter((entry) => (
      entry.date.getFullYear() === Number(selectedYear) &&
      entry.date.getMonth() === Number(selectedMonth)
    ))

  function getDateValue(date: Date): string {
    return String(date.getTime())
  }

  function getMonthLabel(month: number): string {
    return new Date(2000, month).toLocaleString('en-AU', { month: 'short' }).toLowerCase()
  }

  function getDateLabel(date: Date): string {
    return formatJournalDateDisplay(date).toLowerCase()
  }

  function toggleMenu(menu: Exclude<JumpMenu, null>) {
    // Only one menu opens at a time, keeping this small navigation area clear.
    setOpenMenu((currentMenu) => currentMenu === menu ? null : menu)
  }

  function handleYearChange(year: string) {
    // A new year changes the available months, so clear the smaller choices
    // rather than leaving a date selected from the old year.
    setSelectedYear(year)
    setSelectedMonth('')
    setSelectedDate('')
    setOpenMenu(year === '' ? null : 'month')
  }

  function handleMonthChange(month: string) {
    // The date list depends on the selected month, so start it fresh too.
    setSelectedMonth(month)
    setSelectedDate('')
    setOpenMenu(month === '' ? null : 'date')
  }

  function handleDateChange(value: string) {
    setSelectedDate(value)
    const entry = dates.find((candidate) => getDateValue(candidate.date) === value)
    if (entry) onJumpToDate(entry.date)
    setOpenMenu(null)
  }

  const selectedEntry = dates.find((entry) => getDateValue(entry.date) === selectedDate)

  if (collapsed) {
    return (
      <aside className="sidebar sidebar-right sidebar-collapsed">
        <button
          className="sidebar-toggle"
          onClick={() => onCollapsedChange(false)}
          title="expand library"
          aria-label="expand library"
        >
          ‹
        </button>
      </aside>
    )
  }

  return (
    <aside className="sidebar sidebar-right">
      <div className="sidebar-label sidebar-label-row panel-header">
        <span>library</span>
        <button
          className="sidebar-toggle-inline"
          onClick={() => onCollapsedChange(true)}
          title="collapse library"
          aria-label="collapse library"
        >
          ›
        </button>
      </div>
      <div className="library-jump-controls" aria-label="jump to a journal date">
        <div className="library-jump-field">
          <span className="library-jump-label">year</span>
          <button type="button" className="library-jump-trigger" onClick={() => toggleMenu('year')} aria-haspopup="listbox" aria-expanded={openMenu === 'year'} aria-controls="library-year-menu">
            <span>{selectedYear || 'year'}</span><span aria-hidden="true">⌄</span>
          </button>
          {openMenu === 'year' && (
            <div id="library-year-menu" className="library-jump-menu" role="listbox" aria-label="year">
              <button type="button" className="library-jump-option" role="option" aria-selected={selectedYear === ''} onClick={() => handleYearChange('')}>all years</button>
              {years.map((year) => <button type="button" key={year} className={`library-jump-option${selectedYear === String(year) ? ' is-selected' : ''}`} role="option" aria-selected={selectedYear === String(year)} onClick={() => handleYearChange(String(year))}>{year}</button>)}
            </div>
          )}
        </div>
        <div className="library-jump-field">
          <span className="library-jump-label">month</span>
          <button type="button" className="library-jump-trigger" onClick={() => toggleMenu('month')} disabled={selectedYear === ''} aria-haspopup="listbox" aria-expanded={openMenu === 'month'} aria-controls="library-month-menu">
            <span>{selectedMonth === '' ? 'month' : getMonthLabel(Number(selectedMonth))}</span><span aria-hidden="true">⌄</span>
          </button>
          {openMenu === 'month' && (
            <div id="library-month-menu" className="library-jump-menu" role="listbox" aria-label="month">
              <button type="button" className="library-jump-option" role="option" aria-selected={selectedMonth === ''} onClick={() => handleMonthChange('')}>all months</button>
              {months.map((month) => <button type="button" key={month} className={`library-jump-option${selectedMonth === String(month) ? ' is-selected' : ''}`} role="option" aria-selected={selectedMonth === String(month)} onClick={() => handleMonthChange(String(month))}>{getMonthLabel(month)}</button>)}
            </div>
          )}
        </div>
        <div className="library-jump-field">
          <span className="library-jump-label">date</span>
          <button type="button" className="library-jump-trigger" onClick={() => toggleMenu('date')} disabled={selectedMonth === ''} aria-haspopup="listbox" aria-expanded={openMenu === 'date'} aria-controls="library-date-menu">
            <span>{selectedEntry ? getDateLabel(selectedEntry.date) : 'date'}</span><span aria-hidden="true">⌄</span>
          </button>
          {openMenu === 'date' && (
            <div id="library-date-menu" className="library-jump-menu" role="listbox" aria-label="date">
              <button type="button" className="library-jump-option" role="option" aria-selected={selectedDate === ''} onClick={() => handleDateChange('')}>all dates</button>
              {dates.map((entry) => <button type="button" key={entry.heading} className={`library-jump-option${selectedDate === getDateValue(entry.date) ? ' is-selected' : ''}`} role="option" aria-selected={selectedDate === getDateValue(entry.date)} onClick={() => handleDateChange(getDateValue(entry.date))}>{getDateLabel(entry.date)}</button>)}
            </div>
          )}
        </div>
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

// The date list stays still while body text and save indicators change.
export default memo(RightLibraryPanel)
