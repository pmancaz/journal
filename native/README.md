# journal — native macOS edition

Version **0.2.8** combines SwiftUI navigation, native toolbar and dialogs, Swift Charts recurring themes, and a local TipTap editor in WKWebView. The build targets Apple Silicon and macOS 26+. See the [main README](../README.md) for setup, screenshots and usage.

## Build

```sh
npm ci
JOURNAL_APP_OUTPUT="$PWD/build/journal.app" bash native/build.sh
```

Requires Node 22, npm, Python 3 and Apple's Command Line Tools with a macOS 26 SDK. The scripts default to `/Library/Developer/CommandLineTools/SDKs/MacOSX26.sdk`; set `JOURNAL_MACOS_SDK` to an alternative SDK path and, when necessary, `DEVELOPER_DIR` to the matching Apple toolchain. Explicit selection avoids an incompatible newer default SDK.

The build stages a fresh bundle and verifies its ad-hoc signature before replacing the output. It refuses unrelated app destinations and symlinks. Default output is `../journal.app`. `SKIP_WEB=1` reuses installed Web resources (or `JOURNAL_WEB_SOURCE`); use a full build for frontend changes. Build outputs are not committed or notarised.

## Saving and recovery

**Save Journal To…** in More/File chooses the ongoing HTML destination. Autosave, Command-S and normal quit update it while retaining a private local recovery draft. **Open journal…** imports a local copy and disconnects the previous destination; select Save Journal To afterwards to establish a link. Export writes a copy.

Startup recovers a linked file if the local draft is missing. An unreadable or empty existing draft is reported. Files changed outside the app are not silently overwritten; choose a new destination or explicitly confirm replacement after reviewing the copies. When destination saving fails, local recovery is retained, and closing offers a Local Copy option if recovery succeeded.

Storage remains `~/Library/Application Support/com.pcjournal.native-preview` for compatibility. User-selected files remain in their chosen folders. Imported head metadata is preserved in saved HTML but not executed in the editor. Webview network loads and navigation away from the editor are blocked; explicitly opened HTTP(S) links use the default browser. These controls do not encrypt the on-disk journal.

## Checks

```sh
python3 -m venv .venv
.venv/bin/python -m pip install numpy
JOURNAL_TEST_PYTHON="$PWD/.venv/bin/python" bash native/check.sh
```

The command runs frontend regressions, TypeScript checking, Python worker/setup/schedule tests and native persistence/timeline-store checks. Tests use synthetic journals, temporary directories and mocked inference/network/launchd boundaries. Native suites compile the actual model, persistence and store code. They do not change the installed app, register a real job or inspect a personal journal.

## Local themes

Optional Python analysis uses MiniLM embeddings and a prepared Kokoro reading/chat Qwen runtime. Results remain separate from the source document. See [TIMELINE.md](TIMELINE.md). Repeated Sync requests are coalesced; Stop can cancel a pending start. Stable IDs distinguish themes with identical labels. Setup and schedule replacement validate first and attempt to restore prior working state on failure.

## Repository layout and provenance

The native edition began from a snapshot of the earlier Tauri 1.1.12 source. The public repository preserves the original upstream history and iOS companion alongside the current desktop source. Native 0.2.8 and legacy 1.1.12 are separate version lines.
