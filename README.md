# Journal

Journal is a lightweight local-first writing app for keeping a long-running journal in a single file. It is built as a desktop app with React, TypeScript, Vite, and Tauri, and it is designed to feel simple and quick to write in rather than like a heavy document editor.

## What It Does

- Opens and saves journal files locally on your computer
- Uses a rich-text writing surface instead of raw Markdown while editing
- Saves the main journal format as HTML for cleaner copy-paste into places like Substack or WordPress
- Exports Markdown when needed
- Autosaves while you write
- Adds a `new day` section with a dated heading
- Includes a typewriter mode for centered writing
- Includes collapsible side panels for repeated-word "ideas" and a dated entry library
- Shows recent files on launch so the last journal can be reopened quickly

## How It Works

The app uses TipTap as the editor surface, but the source of truth for saved files is HTML. That means the writing experience stays clean and formatted, while the saved file is still portable and easy to reuse elsewhere.

At a high level:

1. The app opens or creates an HTML journal file.
2. The file body is loaded into the editor.
3. As you type, the app updates local state and autosaves the latest content back to disk.
4. The app also parses dated headings to build the right-hand library and counts repeated words to build the ideas panel.

## Project Structure

- `src/`
  Frontend app code, including the main app shell, editor, toolbar, and side panels.
- `src/components/`
  UI pieces such as the editor, top toolbar, ideas panel, and library panel.
- `src/lib/`
  File handling, date parsing, journal parsing, word counting, and typewriter logic.
- `src-tauri/`
  Native desktop wrapper, app configuration, permissions, icons, and Rust entry points.
- `project-overview.md`
  Maintained internal project notes for future development passes.

## Running It

Install dependencies:

```bash
npm install
```

Run the web development version:

```bash
npm run dev
```

Run the desktop development app:

```bash
npm run tauri:dev
```

Build the frontend:

```bash
npm run build
```

Build the standalone desktop app:

```bash
npm run tauri:build
```

## Notes

- This repository intentionally excludes private journal content and other personal writing files.
- The app is HTML-first. Markdown is available as an export format, not the main editing format.
- On macOS, the native wrapper disables text-assistance features that can make the editor feel heavier or more intrusive.
