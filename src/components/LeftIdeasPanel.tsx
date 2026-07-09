import { useState } from 'react'
import { WordFrequency } from '../lib/wordCount'

type Props = {
  words: WordFrequency[]
}

export default function LeftIdeasPanel({ words }: Props) {
  const [collapsed, setCollapsed] = useState(true)
  const maxCount = words[0]?.count ?? 1

  if (collapsed) {
    return (
      <aside className="sidebar sidebar-left sidebar-collapsed">
        <button
          className="sidebar-toggle"
          onClick={() => setCollapsed(false)}
          title="expand ideas"
        >
          ›
        </button>
      </aside>
    )
  }

  return (
    <aside className="sidebar sidebar-left">
      <div className="sidebar-label sidebar-label-row">
        <span>ideas</span>
        <button
          className="sidebar-toggle-inline"
          onClick={() => setCollapsed(true)}
          title="collapse ideas"
        >
          ‹
        </button>
      </div>
      <div className="ideas-list">
        {words.map(({ word, count }) => (
          <div key={word} className="idea-row">
            <span className="idea-word">{word}</span>
            <span className="idea-count">{count}</span>
            <div
              className="idea-bar"
              style={{ width: `${(count / maxCount) * 100}%` }}
            />
          </div>
        ))}
        {words.length === 0 && (
          <div className="sidebar-empty">start writing to see recurring ideas</div>
        )}
      </div>
    </aside>
  )
}
