import { describe, expect, it } from 'vitest'
import { parseHeadingDate } from './dates'

describe('literal calendar heading dates', () => {
  it.each(['2026-02-29 Sunday', '2026-02-31', '2026-13-01', '260231 - Monday', '## 2026-04-31', '## Tuesday 31 April 2026'])('rejects invalid date %s rather than moving the entry to another day', heading => {
    expect(parseHeadingDate(heading)).toBeNull()
  })
  it.each(['2024-02-29 Thursday', '240229 - Thursday', '## *2024-02-29*', '## Thursday 29 February 2024', ' 2024-02-29 Thursday '])('recognizes supported heading %s', heading => {
    const date = parseHeadingDate(heading)!
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2024, 1, 29])
  })
  it('does not silently map a four-digit year below 100 into the 1900s', () => {
    expect(parseHeadingDate('0099-01-01')?.getFullYear()).toBe(99)
  })
  it('round-trips every day of leap and non-leap years without timezone rollover', () => {
    for (const year of [2023, 2024, 2026]) {
      for (let month = 0; month < 12; month++) {
        const count = new Date(year, month + 1, 0).getDate()
        for (let day = 1; day <= count; day++) {
          const heading = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const date = parseHeadingDate(heading)!
          expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([year, month, day])
        }
      }
    }
  })
})
