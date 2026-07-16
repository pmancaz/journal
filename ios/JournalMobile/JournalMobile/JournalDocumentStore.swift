import Foundation
import UIKit

@MainActor
final class JournalDocumentStore: ObservableObject {
    @Published private(set) var html = "<p><br></p>"
    @Published private(set) var documentName = "No journal selected"
    @Published private(set) var statusMessage = "choose your iCloud journal"
    @Published private(set) var isDocumentOpen = false
    @Published private(set) var hasUnsavedChanges = false
    @Published private(set) var hasRemoteChange = false

    private let bookmarkKey = "journal-ios-document-bookmark"
    private var documentURL: URL?
    private var filePresenter: JournalFilePresenter?
    private var lastSavedHTML = ""
    private var pendingRemoteHTML: String?
    private var saveTask: Task<Void, Never>?
    private var foregroundObserver: NSObjectProtocol?

    init() {
        foregroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.checkForRemoteChanges()
            }
        }

        Task { @MainActor in
            restoreLastDocument()
        }
    }

    deinit {
        if let foregroundObserver {
            NotificationCenter.default.removeObserver(foregroundObserver)
        }
        saveTask?.cancel()
        if let documentURL {
            documentURL.stopAccessingSecurityScopedResource()
        }
    }

    func openDocument(at url: URL) {
        saveTask?.cancel()
        stopAccessingCurrentDocument()

        guard url.startAccessingSecurityScopedResource() else {
            statusMessage = "could not access that file"
            return
        }

        do {
            let fullHTML = try coordinatedRead(from: url)
            let editorHTML = unwrapHTMLDocument(fullHTML)
            try saveBookmark(for: url)
            setOpenDocument(url: url, html: editorHTML)
            statusMessage = "opened from iCloud Drive"
        } catch {
            url.stopAccessingSecurityScopedResource()
            statusMessage = "could not open that file"
        }
    }

    func updateEditorHTML(_ updatedHTML: String) {
        guard isDocumentOpen, updatedHTML != html else { return }
        html = updatedHTML
        hasUnsavedChanges = true
        statusMessage = "saving changes"
        scheduleSave()
    }

    func saveImmediately() {
        saveTask?.cancel()
        saveCurrentChanges()
    }

    func checkForRemoteChanges() {
        guard let documentURL, isDocumentOpen else { return }

        do {
            let remoteHTML = unwrapHTMLDocument(try coordinatedRead(from: documentURL))
            guard remoteHTML != lastSavedHTML else { return }

            if hasUnsavedChanges {
                pendingRemoteHTML = remoteHTML
                hasRemoteChange = true
                statusMessage = "journal changed in iCloud"
            } else {
                html = remoteHTML
                lastSavedHTML = remoteHTML
                statusMessage = "updated from iCloud"
            }
        } catch {
            statusMessage = "could not refresh iCloud journal"
        }
    }

    func reloadRemoteVersion() {
        guard let remoteHTML = pendingRemoteHTML else {
            checkForRemoteChanges()
            return
        }

        saveTask?.cancel()
        html = remoteHTML
        lastSavedHTML = remoteHTML
        pendingRemoteHTML = nil
        hasUnsavedChanges = false
        hasRemoteChange = false
        statusMessage = "reloaded from iCloud"
    }

    func saveLocalConflictCopy() {
        guard hasRemoteChange else { return }

        do {
            let documentsFolder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let formatter = ISO8601DateFormatter()
            let suffix = formatter.string(from: Date()).replacingOccurrences(of: ":", with: "-")
            let copyURL = documentsFolder.appendingPathComponent("Journal conflict \(suffix).html")
            try wrapHTMLDocument(html).write(to: copyURL, atomically: true, encoding: .utf8)
            statusMessage = "saved a local conflict copy"
        } catch {
            statusMessage = "could not save conflict copy"
        }
    }

    private func restoreLastDocument() {
        guard let bookmarkData = UserDefaults.standard.data(forKey: bookmarkKey) else { return }

        var bookmarkIsStale = false
        do {
            let url = try URL(
                resolvingBookmarkData: bookmarkData,
                // iOS document-picker bookmarks carry their scoped access
                // automatically. The explicit option exists on macOS only.
                options: [],
                relativeTo: nil,
                bookmarkDataIsStale: &bookmarkIsStale
            )

            guard url.startAccessingSecurityScopedResource() else {
                statusMessage = "choose your iCloud journal"
                return
            }

            let editorHTML = unwrapHTMLDocument(try coordinatedRead(from: url))
            if bookmarkIsStale {
                try saveBookmark(for: url)
            }
            setOpenDocument(url: url, html: editorHTML)
            statusMessage = "opened saved journal"
        } catch {
            UserDefaults.standard.removeObject(forKey: bookmarkKey)
            statusMessage = "choose your iCloud journal"
        }
    }

    private func setOpenDocument(url: URL, html: String) {
        documentURL = url
        documentName = url.lastPathComponent
        self.html = html
        lastSavedHTML = html
        pendingRemoteHTML = nil
        hasUnsavedChanges = false
        hasRemoteChange = false
        isDocumentOpen = true
        installFilePresenter(for: url)
    }

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled else { return }
            self?.saveCurrentChanges()
        }
    }

    private func saveCurrentChanges() {
        guard let documentURL, hasUnsavedChanges else { return }
        guard !hasRemoteChange else { return }

        do {
            // Read once before writing. If iCloud delivered another device's
            // change after our last save, never overwrite it silently.
            let remoteHTML = unwrapHTMLDocument(try coordinatedRead(from: documentURL))
            guard remoteHTML == lastSavedHTML else {
                pendingRemoteHTML = remoteHTML
                hasRemoteChange = true
                statusMessage = "journal changed in iCloud"
                return
            }

            try coordinatedWrite(wrapHTMLDocument(html), to: documentURL)
            lastSavedHTML = html
            hasUnsavedChanges = false
            statusMessage = "saved to iCloud"
        } catch {
            statusMessage = "could not save to iCloud"
        }
    }

    private func saveBookmark(for url: URL) throws {
        let bookmarkData = try url.bookmarkData(
            // Unlike macOS, iOS does not allow the explicit security-scope
            // flag here. The URL from the Files picker already owns that scope.
            options: [],
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )
        UserDefaults.standard.set(bookmarkData, forKey: bookmarkKey)
    }

    private func stopAccessingCurrentDocument() {
        if let filePresenter {
            NSFileCoordinator.removeFilePresenter(filePresenter)
        }
        filePresenter = nil
        if let documentURL {
            documentURL.stopAccessingSecurityScopedResource()
        }
        documentURL = nil
    }

    private func installFilePresenter(for url: URL) {
        if let filePresenter {
            NSFileCoordinator.removeFilePresenter(filePresenter)
        }

        let presenter = JournalFilePresenter(url: url) { [weak self] in
            self?.checkForRemoteChanges()
        }
        filePresenter = presenter
        NSFileCoordinator.addFilePresenter(presenter)
    }

    private func coordinatedRead(from url: URL) throws -> String {
        var coordinationError: NSError?
        var readError: Error?
        var result = ""

        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { safeURL in
            do {
                result = try String(contentsOf: safeURL, encoding: .utf8)
            } catch {
                readError = error
            }
        }

        if let coordinationError { throw coordinationError }
        if let readError { throw readError }
        return result
    }

    private func coordinatedWrite(_ contents: String, to url: URL) throws {
        var coordinationError: NSError?
        var writeError: Error?

        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { safeURL in
            do {
                try contents.write(to: safeURL, atomically: true, encoding: .utf8)
            } catch {
                writeError = error
            }
        }

        if let coordinationError { throw coordinationError }
        if let writeError { throw writeError }
    }

    private func wrapHTMLDocument(_ editorHTML: String) -> String {
        """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Journal</title>
        </head>
        <body>
        \(editorHTML)
        </body>
        </html>
        """
    }

    private func unwrapHTMLDocument(_ fileContents: String) -> String {
        let pattern = "(?is)<body[^>]*>(.*?)</body>"
        guard let expression = try? NSRegularExpression(pattern: pattern),
              let match = expression.firstMatch(in: fileContents, range: NSRange(fileContents.startIndex..., in: fileContents)),
              let bodyRange = Range(match.range(at: 1), in: fileContents) else {
            return fileContents
        }

        return String(fileContents[bodyRange])
    }
}
