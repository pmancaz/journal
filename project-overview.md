# Project Overview

## What This Project Is

`pc_journal` is a local-first journaling app built with React, TypeScript, Vite, and Tauri. The current app treats HTML as the main saved format and uses TipTap as the editor surface, with Markdown export available as a secondary action.

## What It Appears To Be For

This looks like a lightweight daily journal for writing into one long file while still keeping navigation and review simple.

Evidence from the current code:
- The toolbar centers on `new file`, `open file`, `export md`, and `today`.
- The `today` action appends a dated `h2` section if today's entry is missing, or jumps to today's section if it already exists.
- The right sidebar groups dated entries by month and lets the user jump to a day.
- The empty state keeps a recent-files list so the last journal can be reopened quickly.
- HTML is written back to disk directly, which keeps the saved journal closer to what publishing tools expect than a Markdown-first workflow.

## Main Technologies

- React 18
- TypeScript
- Vite
- Tauri 2
- TipTap editor
- `turndown` for HTML-to-Markdown export
- Tauri dialog and filesystem plugins for local file open/save

## Repository Layout

### Frontend entry points

- [`src/main.tsx`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/main.tsx)
  React bootstrap file that mounts the app and loads the global stylesheet.
- [`src/App.tsx`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/App.tsx)
  Main app shell. It owns the open file state, autosave timing, recent files, theme, typewriter mode, and the derived sidebar data.
- [`src/styles/globals.css`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/styles/globals.css)
  Global visual system for the app shell, editor area, sidebars, and theme tokens.

### UI components

- [`src/components/Toolbar.tsx`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/components/Toolbar.tsx)
  Top-level controls and status indicators.
- [`src/components/Editor.tsx`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/components/Editor.tsx)
  TipTap wrapper that handles editor syncing, pair wrapping, em dash insertion, and typewriter-centering behavior.
- [`src/components/EditorToolbar.tsx`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/components/EditorToolbar.tsx)
  Inline formatting controls for headings and common rich-text marks.
- [`src/components/RightLibraryPanel.tsx`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/components/RightLibraryPanel.tsx)
  Collapsible month library used for jumping to dated entries.

### Journal and utility logic

- [`src/lib/fileStorage.ts`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/lib/fileStorage.ts)
  Opens, creates, reads, and writes the active HTML file through Tauri. It also handles Markdown export and reopening recent paths.
- [`src/lib/journal.ts`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/lib/journal.ts)
  Parses journal headings, appends a new day section, extracts entries, and groups them by month.
- [`src/lib/dates.ts`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/lib/dates.ts)
  Formats journal heading dates and parses both current and older heading styles.
- [`src/lib/wordCount.ts`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/lib/wordCount.ts)
  Counts words for the running day and year totals shown in the toolbar.
- [`src/lib/typewriter.ts`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/lib/typewriter.ts)
  Keeps the caret centered when typewriter mode is active.

### Desktop shell

- [`src-tauri/tauri.conf.json`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src-tauri/tauri.conf.json)
  Tauri app metadata, window settings, and build commands.
- [`src-tauri/src/lib.rs`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src-tauri/src/lib.rs)
  Registers the dialog and filesystem plugins, enables debug logging, and disables native macOS text-assistance features that would make the journal feel heavier.
- [`src-tauri/src/main.rs`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src-tauri/src/main.rs)
  Minimal native entry point that hands control to `app_lib::run()`.
- [`src-tauri/capabilities/default.json`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src-tauri/capabilities/default.json)
  Permissions granted to the desktop app.

### Local content and helpers

- [`Open Journal.command`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/Open%20Journal.command)
  Shortcut that launches the app in dev mode.
- [`journal/journalHTML.html`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/journal/journalHTML.html)
  Current live journal content. Treat this as source material, not as a file to rewrite during analysis work.
- [`journal/substack-posts.md`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/journal/substack-posts.md)
  Writing/reference content that appears to be a drafted post or export from the journal workflow.

## Main Flow

1. The app starts from `src/main.tsx` and renders `App`.
2. `App` opens with no file selected and shows the empty state.
3. The user creates a file, opens one from disk, or reopens a recent file through Tauri dialogs in `fileStorage.ts`.
4. The journal body is loaded into TipTap through `Editor.tsx`.
5. Editor changes are synced back to `App` in batches instead of on every keystroke.
6. `App` triggers autosave, recalculates word counts, and rebuilds the month library from the current HTML.
7. `new day` appends a dated heading and a blank paragraph if the current date is missing, then scrolls to that section.

## Behavior Notes

- Typewriter mode recenters the cursor only after real document edits.
- Selection changes and simple mode toggles do not recentre the view.
- The app defers some whole-document work so typing stays responsive on larger journals.
- Save actions and `new day` both ask the editor for the freshest content before writing.
- The journal parser still accepts older heading formats from earlier versions of the app.
- The current HTML journal can contain both dated and non-dated headings, so downstream tools should only treat parseable dates as journal entries.

## Likely Places To Edit

- Save behavior or file opening:
  [`src/App.tsx`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/App.tsx),
  [`src/lib/fileStorage.ts`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/lib/fileStorage.ts)
- Date parsing or monthly grouping:
  [`src/lib/journal.ts`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/lib/journal.ts),
  [`src/lib/dates.ts`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/lib/dates.ts)
- Editor behavior or formatting shortcuts:
  [`src/components/Editor.tsx`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/components/Editor.tsx),
  [`src/components/EditorToolbar.tsx`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/components/EditorToolbar.tsx)
- Sidebar layout or density:
  [`src/components/RightLibraryPanel.tsx`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/components/RightLibraryPanel.tsx),
  [`src/styles/globals.css`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/styles/globals.css)
- Native file access or macOS text-assistance behavior:
  [`src-tauri/src/lib.rs`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src-tauri/src/lib.rs),
  [`src-tauri/capabilities/default.json`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src-tauri/capabilities/default.json),
  [`src-tauri/tauri.conf.json`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src-tauri/tauri.conf.json)
- App icon assets:
  [`src-tauri/icons`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src-tauri/icons),
  [`icon.png`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/icon.png)

## Practical Notes

- This folder is not a Git repository, so direct file inspection is the safest way to understand state.
- `node_modules/` and `src-tauri/target/` are present, so file searches should stay targeted.
- HTML is the primary persisted format; Markdown is only produced on explicit export.
- Keep `journal/journalHTML.html` read-only when building analysis tools or notes about the live journal content.
- The codebase currently uses very few inline comments, so new code should include beginner-friendly comments where the control flow is not obvious.

## Open Questions

- I did not run the desktop app during this familiarization, so visual behavior is inferred from source.
- `journal/substack-posts.md` looks like output or reference material, but its exact role is not yet documented in code.
