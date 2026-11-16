import Foundation

/// File I/O kept separate from WebKit so recovery and conflict handling can be
/// exercised with disposable directories. Only explicit destination selection
/// accepts replacing a different on-disk journal.
final class JournalDiskStore {
    let storage: URL
    private(set) var destination: URL?
    private var expectedDestination: Data?
    private var destinationConflict = false
    var draftURL: URL { storage.appendingPathComponent("preview-draft.html") }
    var settingURL: URL { storage.appendingPathComponent("backup-path.txt") }

    init(storage: URL) {
        self.storage = storage
        if let path = try? String(contentsOf: settingURL, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), !path.isEmpty {
            destination = URL(fileURLWithPath: path)
        }
    }

    func initialHTML(sample: String) throws -> String {
        try prepareStorage()
        let exists = FileManager.default.fileExists(atPath: draftURL.path)
        // An existing but unreadable/invalid recovery draft is an error, never
        // permission to silently replace real writing with the sample.
        if exists {
            let html = try String(contentsOf: draftURL, encoding: .utf8)
            guard !html.isEmpty else { throw failure("The local recovery draft is empty. Open your journal file to recover it; it has not been overwritten.") }
            if let destination {
                do {
                    expectedDestination = try Data(contentsOf: destination)
                    destinationConflict = expectedDestination != Data(html.utf8)
                } catch { destinationConflict = true }
            }
            return html
        }
        if let destination {
            let html = try String(contentsOf: destination, encoding: .utf8)
            guard !html.isEmpty else { throw failure("The linked journal file is empty. No sample has been saved over it.") }
            expectedDestination = Data(html.utf8)
            try writeRecovery(html, sourceName: destination.deletingPathExtension().lastPathComponent)
            return html
        }
        return sample
    }

    var hasConflict: Bool { destinationConflict }

    func writeRecovery(_ html: String, sourceName: String) throws {
        try prepareStorage()
        try writePrivate(html, to: draftURL)
        try writePrivate(sourceName, to: storage.appendingPathComponent("source-name.txt"))
    }

    func writeDestination(_ html: String) throws {
        guard let destination else { return }
        let current: Data?
        if FileManager.default.fileExists(atPath: destination.path) {
            current = try Data(contentsOf: destination)
        } else { current = nil }
        guard !destinationConflict, current == expectedDestination else {
            destinationConflict = true
            throw failure("The journal file has changed outside this app. Your local draft is safe. Use Save Journal To… to choose a new file or explicitly replace the existing one.")
        }
        try html.write(to: destination, atomically: true, encoding: .utf8)
        expectedDestination = Data(html.utf8)
    }

    func selectDestination(_ url: URL, html: String, sourceName: String) throws {
        guard url.resolvingSymlinksInPath().standardizedFileURL != draftURL.resolvingSymlinksInPath().standardizedFileURL else {
            throw failure("Choose a different HTML file. The app’s local recovery draft cannot also be its save destination.")
        }
        try writeRecovery(html, sourceName: sourceName)
        try html.write(to: url, atomically: true, encoding: .utf8)
        try writePrivate(url.path, to: settingURL)
        destination = url
        expectedDestination = Data(html.utf8)
        destinationConflict = false
    }

    func disconnect() throws {
        try prepareStorage()
        try writePrivate("", to: settingURL)
        destination = nil; expectedDestination = nil; destinationConflict = false
    }

    private func prepareStorage() throws {
        try FileManager.default.createDirectory(at: storage, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: storage.path)
    }

    private func writePrivate(_ text: String, to url: URL) throws {
        try text.write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    private func failure(_ message: String) -> NSError {
        NSError(domain: "Journal", code: 3, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

/// The writing web view is a single editor, never a local-file browser. A
/// journal link must not replace it and strand the in-memory journal state.
enum JournalNavigationPolicy {
    static func externalURL(_ raw: String) -> URL? {
        guard let url = URL(string: raw), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), let host = url.host, !host.isEmpty else { return nil }
        return url
    }
    static func permits(_ url: URL, editorURL: URL?) -> Bool {
        guard let editorURL, url.isFileURL else { return false }
        var candidate = URLComponents(url: url, resolvingAgainstBaseURL: false)
        var editor = URLComponents(url: editorURL, resolvingAgainstBaseURL: false)
        candidate?.fragment = nil; editor?.fragment = nil
        return candidate?.url?.standardizedFileURL == editor?.url?.standardizedFileURL
    }
}
