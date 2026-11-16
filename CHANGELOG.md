# Changelog

Native and legacy desktop editions have separate version lines.

## Publication maintenance - 2026-11-16

- Document the native 0.2.8 edition, build steps, optional local AI dependencies and HTML save workflow.
- Add original demo screenshots and third-party notices; exclude private documents, derived data, models and build outputs.
- Select the macOS 26 SDK explicitly in build/check scripts and make the legacy launcher independent of a developer’s home path. No app version bump.

## Native 0.2.8 - 2026-11-06

- Retain the minimal SwiftUI interface, focus/typewriter modes, day/night appearance, dated-note import and separate local recurring-themes timeline introduced across native 0.1–0.2.7.
- Fix empty-entry caret visibility, text selection and fullscreen day-mode contrast. Keep New Note first in the toolbar and save-location controls in More/File.
- Protect local recovery and chosen HTML destinations against failed writes, stale saves and external changes; preserve imported entries and metadata until edited.
- Coalesce theme sync starts, support cancellation and stable theme IDs, and validate model/schedule replacement before changing working resources.
- Add frontend, Python and native regression coverage for editor, persistence, setup, scheduling and analysis boundaries.

## Legacy desktop 1.1.12 - 2026-10-26

- Remove the faint vertical background rules from Day and Night's top and
  formatting toolbars, and from the Focus header.
- Centre the main writing surface and text in the whole window, with reminders
  to its right. Opening Library no longer shifts the text column left.
- Balance scrollbar gutters so Focus text is centred within its window too.
- Keep reminders accessible in a separate lower-right row when the window is
  too narrow for a side card without squeezing or overlapping the writing.

## 1.1.11 - 2026-10-26

- Add + diagram to the formatting toolbar in both the main editor and Focus.
  It inserts an inline card and opens its editing window immediately.
- Adapt Writing Space's free-positioned flowchart model for journal entries:
  draggable steps, decisions, notes, dated milestones, directional connectors,
  labels, feedback loops, and a six-month timeline starter.
- Add a details inspector, zoom/Fit, keyboard movement, and diagram Undo/Redo.
  Removing a step removes its attached arrows; Undo restores both.
- Save editable diagram source and a standalone SVG preview together inside the
  journal HTML. Reopening, copying inside Journal, saving, recovery, and Focus
  retain the editable diagram. No separate planner storage or service is used.
- Commit diagram edits directly to the document so immediate Save/Quit includes
  the latest change. Protect open diagrams when the journal becomes read-only.
- Validate diagram data, escape SVG text, and retain unsupported source without
  replacing it. Unreadable diagrams offer the existing copyable error report.
- Add round-trip, malformed-data, gestures/history, Focus-save, and protection
  tests. Older Journal builds cannot preserve editable diagram source on save;
  use this version or newer for journals containing diagrams.

## 1.1.10 - 2026-10-26

- Enlarge the Journal title, move it left, and remove the Daily Record subtitle.
- Put New File and Open File in a compact File dropdown; keep protected-draft
  reload there when needed. The menu closes on selection, outside click, or Escape.
- Centre Today and Focus in the top bar. Keep word counts, Typewriter, the save
  indicator, and the theme selector on the right, with a second row in small windows.
- Start Typewriter enabled in both the main editor and Focus. Keep its toggle.
- Always show the save indicator for an open journal and remove its visibility
  toggle and stored preference.

## 1.1.9 - 2026-10-26

- Remove repeated whole-journal HTML parsing from the typing path. Cache HTML,
  dates, and word counts for unchanged editor blocks; refresh the library only
  when dated headings change.
- Keep Focus edits in their own editor, composing saves with preserved adjacent
  entries. Refresh the hidden main document once when Focus closes.
- Find the caret's date by looking backwards to its nearest heading; cache the
  reminder heading index and use binary search for visible entry placement.
- Run recovery hashing, backup scanning, and durable disk writes on a native
  background worker so they cannot hold up Mac window events.
- Keep formatting indicators subscribed to formatting changes, and add typing
  performance, rich-content preservation, and Focus save regression coverage.

## 1.1.8 - 2026-10-25

- Reset editor Undo history when opening or reloading a journal.
- Flush the active Focus editor for explicit saving and native close/quit;
  wait for durable writing before exiting and keep errors copyable on failure.
  A native AppKit termination hook also covers the Mac Quit menu and Dock Quit.
- Preserve the newest queued and visible edits when a save detects a conflict.
- Report draft/snapshot failures even when the main journal saves successfully;
  serialize background draft writes with autosave drafts.
- Correct empty-body HTML replacement and quoted body attributes.
- Track pending image positions through edits and cancel imports into replaced,
  destroyed, or protected editors; show image-read errors in the report dialog.
- Use the shared date parser for library navigation, including compact dates.
- Deduplicate recovery copies within their own category, keeping conflict copies
  independent of snapshots that may later be pruned.
- Coordinate Mac writes with file providers and a local process lock; use unique
  temporary files, retain file permissions, and sync the containing directory.
- Add editor, window-lifecycle, recovery, and concurrent-writer regression tests.

## 1.1.7 - 2026-10-25

- Made the app Mac-only: journals open ready to edit, with no writing leases,
  takeover/stop controls, renewal timer, follower polling, or native iPad bridge.
- Removed old ownership metadata on normal saves while preserving HTML content.
- Kept recovery copies, copyable error reports, and external-change protection;
  failed saves keep the visible draft, with a protected reload action when needed.
- Flush pending edits before switching files and recover cleanly from save errors.
- Moved both right corner ornaments clear of the library tab and drawer; upper
  ornaments also clear wrapped formatting controls in narrow windows.
- Updated the project overview and added Mac saving regression coverage.

## 1.1.6 - 2026-09-01

- Added follower/writer ownership, expiring writer leases, SHA-256 revision
  checks, single-flight saves, follower refresh, and Apple conflict detection.
- Added local latest-draft storage, deduplicated snapshots, conflict copies,
  recovery preview/export, and fuller copyable error reports.
- Added the shared `DocumentBackend` used by Tauri on Mac and native WebKit on
  the iPad companion.
- Added touch-friendly shared interface behaviour and native iPad photo/link
  hooks while keeping compatible HTML.
- Removed Markdown export and its Turndown dependencies.
- Added unit coverage for HTML shell preservation, leases, hashing, stale-write
  rejection, and diagnostic report contents.

## 1.1.5

- Previous packaged desktop release before the guarded sync work.
