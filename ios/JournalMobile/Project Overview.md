# Project Overview

## What This Is

`JournalMobile` is the native iPhone and iPad companion for the desktop
`pc_journal` app. It intentionally saves the same HTML journal file used on
the Mac instead of maintaining a separate mobile copy or database.

## Main Flow

1. The user chooses their journal HTML file through Apple's Files picker.
2. The picker opens the original file in place from iCloud Drive.
3. `JournalDocumentStore` keeps Apple's bookmark data, so the same document can
   be reopened after the app is relaunched.
4. The WebKit writing surface edits the document body as HTML and autosaves it
   after a short pause.
5. iCloud Drive transports the file changes between iPhone, iPad, and Mac.

## Important Safety Behaviour

- Use the **same file** from iCloud Drive on each device.
- The app coordinates all external-file reads and writes with `NSFileCoordinator`.
- `JournalFilePresenter` notices a file change delivered by iCloud while the
  app is open.
- If the user has unsaved typing and another device changes the file, the app
  stops instead of overwriting the remote version. The user can reload the
  remote version or preserve their typing as a local conflict copy.
- Actual iCloud sync must be tested on physical devices signed into the same
  Apple ID. The simulator verifies the UI and code, but does not prove iCloud
  Drive delivery between devices.

## Files

- `project.yml`: XcodeGen source configuration. Regenerate the project after
  changing it with `xcodegen generate`.
- `JournalMobileApp.swift`: application entry point.
- `ContentView.swift`: compact iPhone/iPad interface and writing controls.
- `JournalDocumentPicker.swift`: Apple Files picker wrapper.
- `JournalDocumentStore.swift`: bookmarks, file coordination, autosave, and
  conflict protection.
- `JournalFilePresenter.swift`: immediate external-change notifications.
- `JournalWebEditor.swift`: HTML editor that preserves the desktop document
  format.

## Building

Open `JournalMobile.xcodeproj` in Xcode. Choose your Apple development team in
**Signing & Capabilities**, select an iPhone or iPad, and run the app. The
project uses the bundle identifier `com.pmancaz.journal`; change that in
`project.yml` first if it is already taken by another app in your team.
