# Journal for iPhone and iPad

This is a native iOS companion for the desktop journal. It works with the same
HTML journal file rather than creating a separate mobile database.

## How Syncing Works

1. Move or save the desktop journal HTML file into **iCloud Drive**.
2. On each iPhone or iPad, open this app and choose that same file in the
   system Files picker.
3. The app opens the file in place, so its autosaves go to iCloud Drive.
4. The desktop app can then open the same iCloud Drive file as usual.

The iOS app stores Apple's security bookmark for the file, so it can reopen the
same journal after a relaunch. If iCloud delivers a newer version while this app
has unsaved typing, it stops instead of overwriting that version. You can reload
the remote document or first save a protected local conflict copy.

## Opening in Xcode

The project is generated from `project.yml`:

```bash
cd "ios/JournalMobile"
xcodegen generate
open JournalMobile.xcodeproj
```

Choose an iPhone or iPad in Xcode, set your personal development team under
**Signing & Capabilities** if Xcode asks, then press the Run button.

## Important Note

This project does not need an iCloud container entitlement because it uses the
user-selected iCloud Drive file through Apple's Files picker. The file remains
in the user's chosen folder and is shared by iCloud Drive itself.
