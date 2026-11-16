# Project overview

The main development target is journal's native macOS edition, version 0.2.8. The earlier React/Tauri desktop app (1.1.12) and iOS companion remain in the repository as separate implementations.

| Area | Source | Role |
| --- | --- | --- |
| macOS shell | `native/JournalNative.swift` | SwiftUI navigation, day selection, editor bridge, dated-note dialog, appearance and app lifecycle |
| Document storage | `native/JournalPersistence.swift` | Private recovery draft, selected HTML destination, external-change checks and atomic file writes |
| Themes UI/store | `native/ThoughtTimeline.swift` | Swift Charts timeline, separate window, manual sync, cancellation and schedule controls |
| Local analysis | `native/timeline_worker.py` | Read-only journal parsing, embeddings, clustering, summaries and derived SQLite/JSON data |
| Runtime setup | `native/setup_timeline.py` | MiniLM downloads/checksum, ONNX environment and prepared Kokoro runtime configuration |
| Daily job | `native/install_timeline_schedule.py` | Local user LaunchAgent installation, validation, replacement and rollback |
| Native editor | `src/NativePreview.tsx`, `src/native-preview.css` | Local TipTap writing surface hosted in WKWebView |
| Shared editor/data | `src/components`, `src/lib` | Rich text, HTML sections, dates, snapshots, diagrams and legacy persistence |
| Legacy desktop | `src/App.tsx`, `src-tauri` | Earlier React/Tauri interface and Rust backend |
| iOS companion | `ios/JournalMobile` | Separate original mobile implementation; not validated in this publication |

The journal is a single HTML document organised by dated h2 headings. The native shell retains a private local recovery draft and can autosave to a user-selected HTML destination. Opening a document imports it locally; it does not establish an ongoing save link until Save Journal To is used.

AI analysis reads the local draft and writes a separate cache and timeline, never journal entries. Runtime packages, weights, caches, models, app bundles and personal documents are excluded from source control. The native bundle identity stays `com.pcjournal.native-preview` to retain data/settings compatibility.

See [README](README.md), [native development](native/README.md), [timeline](native/TIMELINE.md), [changelog](CHANGELOG.md), and [third-party acknowledgements](docs/ACKNOWLEDGEMENTS.md).
