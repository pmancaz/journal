# Project Overview

## What This Project Is

`pc_journal` is a local-first journaling app built with React, TypeScript, Vite, and Tauri. The current app treats HTML as the main saved format and uses TipTap as the editor surface, with Markdown export available as a secondary action.

## What It Appears To Be For

This looks like a lightweight daily journal for writing into one long file while still keeping navigation and review simple.

Evidence from the current code:
- The toolbar centers on `new file`, `open file`, `export md`, `today`, and `focus`.
- The `today` action appends a dated `h2` section if today's entry is missing, then takes the full editor to it. The `focus` action opens the dated entry at the current caret position or a date selected from the library.
- The right sidebar groups dated entries by month and lets the user jump to a day, either from the visible list or its year/month/date chooser.
- The empty state keeps a recent-files list so the last journal can be reopened quickly.
- HTML is written back to disk directly, which keeps the saved journal closer to what publishing tools expect than a Markdown-first workflow.

## Design System Baseline

The journal follows the shared Pat Carroll desktop-app visual system in
[`PC_Design System.md`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/Design/PC_Design%20System.md).

- IBM Plex Mono is the sole interface typeface, with compact lowercase actions and uppercase structural labels.
- Day and night mode use shared neutral tokens. Nautical is an optional third appearance: cyan forms a quiet technical frame while orange marks focused actions and active editing states.
- The interface uses thin one-pixel rules, square controls, restrained hover states, and a 48px top bar rather than rounded cards or shadows.
- The main editor has a full-height, solid reading column with faint vertical boundary rules. In Nautical this intentionally masks the grid behind text while leaving it visible in the surrounding workspace.
- The library header includes the system's small calibration mark. In Nautical it uses cyan; keep that detail limited to major framed areas so it remains distinctive.
- Accessibility details include dashed keyboard focus, pressed states for toggles, and reduced-motion handling.
- The current journal icon deliberately remains separate from the blue-accent system: it was recently refreshed around the app's black, white, and green book motif and should not be replaced without a specific icon request.

## Main Technologies

- React 18
- TypeScript
- Vite
- Tauri 2
- TipTap editor
- `turndown` for HTML-to-Markdown export
- Tauri dialog and filesystem plugins for local file open/save
- Native SwiftUI, UIKit document picker, and WebKit for the iPhone/iPad companion

## iPhone and iPad Companion

[`ios/JournalMobile`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/ios/JournalMobile)
is a separate native iOS project. It is intentionally not a second journal
database: it opens the same user-selected HTML file from iCloud Drive and saves
back to that file in place.

- The Files picker grants access to the iCloud Drive document, and the app saves
  a bookmark so the same file can be reopened later.
- `NSFileCoordinator` and `NSFilePresenter` coordinate external file access and
  detect updates arriving from another device.
- The mobile app refuses to silently overwrite a changed remote file when it
  has local unsaved typing. It offers a reload or a protected local conflict copy.
- The iOS project is generated from `ios/JournalMobile/project.yml` with
  XcodeGen and supports both iPhone and iPad.

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
- [`src/components/FocusView.tsx`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/components/FocusView.tsx)
  Portrait focus overlay for editing one selected journal entry body while retaining the same autosave flow.
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
  Counts words for the running day and year totals shown in the toolbar. `journal.ts` scopes the year total to dated entries from the current calendar year.
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

### iOS companion

- [`ios/JournalMobile/JournalMobile.xcodeproj`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/ios/JournalMobile/JournalMobile.xcodeproj)
  Native Xcode project used to install the journal on iPhone and iPad.
- [`ios/JournalMobile/JournalMobile/JournalDocumentStore.swift`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/ios/JournalMobile/JournalMobile/JournalDocumentStore.swift)
  Owns the selected iCloud Drive file, bookmark, autosave, and conflict safety.
- [`ios/JournalMobile/JournalMobile/JournalWebEditor.swift`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/ios/JournalMobile/JournalMobile/JournalWebEditor.swift)
  Lightweight HTML editor that works with the same body content saved by the desktop app.

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
- The toolbar's year total counts text within dated entries from the current calendar year, rather than all content in a multi-year document.
- Focus View is a portrait overlay for writing one dated entry at a time. It includes an entry word count and its own typewriter mode, edits only that entry body, immediately merges the change back into the full HTML journal, and uses the normal autosave path.

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
- Shared visual language:
  [`src/styles/globals.css`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src/styles/globals.css),
  [`PC_Design System.md`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/Design/PC_Design%20System.md)
- Native file access or macOS text-assistance behavior:
  [`src-tauri/src/lib.rs`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src-tauri/src/lib.rs),
  [`src-tauri/capabilities/default.json`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src-tauri/capabilities/default.json),
  [`src-tauri/tauri.conf.json`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/src-tauri/tauri.conf.json)
- iCloud Drive file access or mobile sync safety:
  [`ios/JournalMobile/JournalMobile/JournalDocumentStore.swift`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/ios/JournalMobile/JournalMobile/JournalDocumentStore.swift),
  [`ios/JournalMobile/JournalMobile/JournalFilePresenter.swift`](/Users/patrickcarroll/Dropbox/Creative%20Projects/Programs/pc_journal/ios/JournalMobile/JournalMobile/JournalFilePresenter.swift)
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
