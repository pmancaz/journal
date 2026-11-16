#!/bin/bash
# Isolated checks only: no live journal, model inference, schedule, or installed app changes.
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Library/Developer/CommandLineTools}"
SDK="$(xcrun --sdk "${JOURNAL_MACOS_SDK:-/Library/Developer/CommandLineTools/SDKs/MacOSX26.sdk}" --show-sdk-path)"
npm test
npm exec tsc -- --noEmit
"${JOURNAL_TEST_PYTHON:-python3}" -m unittest discover -s native -p 'test_*.py' -v
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/journal-check.XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT
for suite in persistence timeline_store; do
  xcrun swiftc -sdk "$SDK" -target arm64-apple-macosx26.0 -D JOURNAL_MODEL_TESTS -parse-as-library native/JournalPersistence.swift native/JournalNative.swift native/ThoughtTimeline.swift "native/test_${suite}.swift" -o "$CHECK_DIR/$suite" -framework SwiftUI -framework Charts -framework WebKit -framework AppKit
  "$CHECK_DIR/$suite"
done
