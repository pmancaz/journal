#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Library/Developer/CommandLineTools}"
SDK="$(xcrun --sdk "${JOURNAL_MACOS_SDK:-/Library/Developer/CommandLineTools/SDKs/MacOSX26.sdk}" --show-sdk-path)"
if [[ "${SKIP_WEB:-0}" != "1" ]]; then
node native/build-web.mjs
# WKWebView's file origin requires a single local classic script.
python3 - <<'PY'
from pathlib import Path
p=Path('native-web/native.html')
p.write_text(p.read_text().replace('type="module" ', 'defer ').replace('crossorigin ', ''))
PY
fi
APP="${JOURNAL_APP_OUTPUT:-../journal.app}"
APP="$(python3 - "$APP" <<'PY'
from pathlib import Path
import plistlib,sys
p=Path(sys.argv[1]).absolute()
if p.suffix != '.app' or p.is_symlink():
    raise SystemExit('Build output must be a non-symlink .app bundle.')
if p.exists():
    try: identity=plistlib.loads((p/'Contents/Info.plist').read_bytes())['CFBundleIdentifier']
    except Exception: raise SystemExit('Refusing to replace a directory that is not a journal app.')
    if identity != 'com.pcjournal.native-preview': raise SystemExit('Refusing to replace a different app.')
p.parent.mkdir(parents=True,exist_ok=True)
print(p)
PY
)"
# Always assemble a fresh bundle: ditto-merging stale Web assets invalidates
# signatures and can silently ship obsolete resources.
STAGE="$(mktemp -d "$(dirname "$APP")/.journal-build.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
BUNDLE="$STAGE/journal.app"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources/Web"
if [[ "${SKIP_WEB:-0}" == "1" ]]; then
WEB_SOURCE="${JOURNAL_WEB_SOURCE:-/Applications/journal.app/Contents/Resources/Web}"
[[ -f "$WEB_SOURCE/native.html" ]] || { echo 'Missing local Web resources for SKIP_WEB build.' >&2; exit 1; }
ditto "$WEB_SOURCE" "$BUNDLE/Contents/Resources/Web"
else
ditto native-web "$BUNDLE/Contents/Resources/Web"
fi
mkdir -p "$BUNDLE/Contents/Resources/Timeline"
cp native/timeline_worker.py "$BUNDLE/Contents/Resources/Timeline/"
cp src-tauri/icons/icon.icns "$BUNDLE/Contents/Resources/Journal.icns"
xcrun swiftc -sdk "$SDK" -parse-as-library -O -target arm64-apple-macosx26.0 native/JournalNative.swift native/JournalPersistence.swift native/ThoughtTimeline.swift -o "$BUNDLE/Contents/MacOS/JournalNative" -framework SwiftUI -framework Charts -framework WebKit -framework AppKit
cat > "$BUNDLE/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>journal</string>
<key>CFBundleDisplayName</key><string>journal</string>
<key>CFBundleIdentifier</key><string>com.pcjournal.native-preview</string>
<key>CFBundleVersion</key><string>10</string>
<key>CFBundleShortVersionString</key><string>0.2.8</string>
<key>CFBundleExecutable</key><string>JournalNative</string>
<key>CFBundleIconFile</key><string>Journal.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>NSHighResolutionCapable</key><true/>
<key>LSMinimumSystemVersion</key><string>26.0</string>
<key>NSPrincipalClass</key><string>NSApplication</string>
<key>NSHumanReadableCopyright</key><string>Local PC Journal interface experiment</string>
</dict></plist>
PLIST
codesign --force --deep --sign - "$BUNDLE"
codesign --verify --deep --strict "$BUNDLE"
if [[ -e "$APP" ]]; then mv "$APP" "$STAGE/previous.app"; fi
if ! mv "$BUNDLE" "$APP"; then
  [[ ! -e "$STAGE/previous.app" ]] || mv "$STAGE/previous.app" "$APP"
  exit 1
fi
echo "$APP"
