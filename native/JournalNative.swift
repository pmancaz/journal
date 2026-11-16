import SwiftUI
import WebKit
import UniformTypeIdentifiers
import Combine

@MainActor final class JournalAppearance: ObservableObject {
    static let shared = JournalAppearance()
    @Published var night = UserDefaults.standard.bool(forKey: "nightMode") {
        didSet { UserDefaults.standard.set(night, forKey: "nightMode"); apply() }
    }
    func apply() { NSApp.appearance = NSAppearance(named: night ? .darkAqua : .aqua) }
}

struct AppearanceButton: View {
    @ObservedObject private var appearance = JournalAppearance.shared
    var body: some View {
        Button { appearance.night.toggle() } label: {
            Label(appearance.night ? "Day mode" : "Night mode", systemImage: appearance.night ? "sun.max" : "moon")
        }.help(appearance.night ? "Switch to day mode" : "Switch to night mode")
    }
}

struct Entry: Identifiable, Decodable, Hashable {
    var id: String
    var date: String
    var words: Int
    var preview: String
    var parsedDate: Date? {
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = Calendar.current.timeZone
        let components = DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)
        guard let value = calendar.date(from: components), calendar.component(.year, from: value) == parts[0], calendar.component(.month, from: value) == parts[1], calendar.component(.day, from: value) == parts[2] else { return nil }
        return value
    }
    var day: String { parsedDate?.formatted(.dateTime.day()) ?? "—" }
    var weekday: String { parsedDate?.formatted(.dateTime.weekday(.wide)) ?? "Undated" }
    var title: String { parsedDate?.formatted(.dateTime.weekday(.wide).day().month(.wide)) ?? "Undated notes" }
    var month: String { parsedDate?.formatted(.dateTime.month(.wide).year()) ?? "Undated" }
}

@MainActor final class JournalModel: ObservableObject {
    static let shared = JournalModel()
    static let dateFormatter: DateFormatter = { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f }()
    @Published var entries: [Entry] = []
    @Published var selected: String? = nil
    @Published var words = 0
    @Published var status = "Ready"
    @Published var sourceName = "A little space to think"
    @Published var error: String? = nil
    @Published var search = ""
    @Published var focus = false
    @Published var typewriter = UserDefaults.standard.object(forKey: "typewriter") as? Bool ?? true
    @Published var formatting = false
    @Published var addingNote = false
    weak var web: WKWebView?
    var ready = false
    @Published var loaded = false
    // Used by native regression tests to delay/reorder editor replies.
    var invokeOverride: ((String, [String: Any]) async throws -> Any?)?
    var saveRequest = 0
    var completedSaveRequest = 0
    var lastDestinationSaveSucceeded = false
    var editRevision = 0
    var localRecoverySaved = false
    var suppressSaveAlerts = false
    var lastSaveFailure: String?
    var generation = 0
    var dirty = false
    var saveTask: Task<Void, Never>?
    let storage: URL
    let disk: JournalDiskStore
    @Published var backupURL: URL?
    var currentEntry: Entry? { entries.first { $0.id == selected } }
    var filtered: [Entry] { entries.filter { search.isEmpty || ($0.title + " " + $0.preview).localizedCaseInsensitiveContains(search) }.sorted { $0.date > $1.date } }
    var months: [String] { var result: [String] = []; for e in filtered { if !result.contains(e.month) { result.append(e.month) } }; return result }

    init(storage: URL? = nil) {
        self.storage = storage ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("com.pcjournal.native-preview", isDirectory: true)
        disk = JournalDiskStore(storage: self.storage)
        backupURL = disk.destination
    }
    func invoke(_ script: String, arguments: [String: Any] = [:]) async throws -> Any? {
        if let invokeOverride { return try await invokeOverride(script, arguments) }
        guard let web, ready else { throw NSError(domain: "Journal", code: 1, userInfo: [NSLocalizedDescriptionKey: "The editor is still loading."]) }
        return try await web.callAsyncJavaScript(script, arguments: arguments, in: nil, contentWorld: .page)
    }
    func loadInitial() { Task { await recoverInitial() } }
    func recoverInitial() async {
        do {
            let html = try disk.initialHTML(sample: Self.sample)
            sourceName = (try? String(contentsOf: storage.appendingPathComponent("source-name.txt"), encoding: .utf8)) ?? "A little space to think"
            guard await load(html) else { return }
            _ = try? await invoke("window.journalNative.typewriter(enabled)", arguments: ["enabled": typewriter])
            if disk.hasConflict {
                error = "The saved journal file differs from the local recovery draft. Your local writing is open, and the file has not been replaced. Use Save Journal To… to choose a destination after reviewing the two copies."
                status = "Local draft open · destination needs review"
            }
        } catch { self.error = error.localizedDescription; status = "Couldn’t recover journal" }
    }
    @discardableResult func load(_ html: String) async -> Bool {
        generation += 1
        loaded = false
        saveTask?.cancel()
        do {
            _ = try await invoke("window.journalNative.load(html)", arguments: ["html": html])
            loaded = true; dirty = false; status = "Saved locally"; return true
        } catch { self.error = error.localizedDescription; status = "Couldn’t open journal"; return false }
    }
    func receive(_ body: Any) {
        guard let message = body as? [String: Any], let type = message["type"] as? String else { return }
        switch type {
        case "ready": ready = true; loaded = false; loadInitial()
        case "state":
            if let values = message["entries"], let data = try? JSONSerialization.data(withJSONObject: values), let values = try? JSONDecoder().decode([Entry].self, from: data) { entries = values }
            selected = message["selected"] as? String
            words = message["words"] as? Int ?? 0
            if message["changed"] as? Bool == true {
                editRevision += 1
                dirty = true; status = "Saving…"; saveTask?.cancel()
                saveTask = Task { try? await Task.sleep(for: .seconds(1)); if !Task.isCancelled { _ = await saveDraft() } }
            }
        case "openExternal":
            if let raw = message["url"] as? String, let url = JournalNavigationPolicy.externalURL(raw) { NSWorkspace.shared.open(url) }
        case "error": error = message["message"] as? String
        default: break
        }
    }
    @discardableResult func saveDraft() async -> Bool {
        // "ready" only means the web bundle is ready, not that a real journal
        // was successfully recovered. Never snapshot its blank loading editor.
        guard ready, loaded else { return !dirty }
        let token = generation
        saveRequest += 1
        let request = saveRequest
        let revision = editRevision
        localRecoverySaved = false
        lastSaveFailure = nil
        do {
            guard let html = try await invoke("return window.journalNative.snapshot()") as? String, !html.isEmpty else { throw NSError(domain: "Journal", code: 2, userInfo: [NSLocalizedDescriptionKey: "The editor did not return a complete draft."]) }
            guard token == generation else { return false }
            // A slower older snapshot must never overwrite a newer completed save.
            guard request > completedSaveRequest else { return lastDestinationSaveSucceeded }
            try disk.writeRecovery(html, sourceName: sourceName)
            localRecoverySaved = true
            completedSaveRequest = request
            lastDestinationSaveSucceeded = false
            do { try disk.writeDestination(html) }
            catch {
                lastSaveFailure = "Your local draft is safe, but the journal file could not be updated at \(backupURL?.path ?? "the selected destination"): \(error.localizedDescription)"
                if !suppressSaveAlerts { self.error = lastSaveFailure }
                status = "Saved locally · journal file save failed"
                return false
            }
            lastDestinationSaveSucceeded = true
            dirty = editRevision != revision
            status = dirty ? "Saving…" : (backupURL == nil ? "Saved locally" : "Saved to journal file")
            return true
        } catch {
            guard token == generation else { return false }
            guard request > completedSaveRequest else { return lastDestinationSaveSucceeded }
            lastSaveFailure = error.localizedDescription
            if !suppressSaveAlerts { self.error = lastSaveFailure }
            status = "Draft not saved"; return false
        }
    }
    func saveJournalTo() {
        Task {
            let panel = NSSavePanel()
            panel.allowedContentTypes = [.html]
            panel.title = "Save Journal To"
            panel.prompt = "Save Journal"
            panel.message = "Your complete journal will be saved here automatically as you write."
            panel.nameFieldStringValue = backupURL?.lastPathComponent ?? "journalHTML.html"
            panel.directoryURL = backupURL?.deletingLastPathComponent()
            guard await panel.begin() == .OK, let url = panel.url else { return }
            let token = generation
            do {
                guard loaded, let html = try await invoke("return window.journalNative.snapshot()") as? String, !html.isEmpty else {
                    throw NSError(domain: "Journal", code: 2, userInfo: [NSLocalizedDescriptionKey: "Open a journal before choosing its save destination."])
                }
                guard token == generation else { return }
                try disk.selectDestination(url, html: html, sourceName: sourceName)
                generation += 1
                backupURL = url
                _ = await saveDraft()
            } catch { self.error = error.localizedDescription }
        }
    }
    func disconnectBackup() throws {
        try disk.disconnect()
        backupURL = nil
    }
    func choose(_ id: String?) {
        guard let id, id != selected else { return }
        Task { do { _ = try await invoke("window.journalNative.select(id)", arguments: ["id": id]) } catch { self.error = error.localizedDescription } }
    }
    func command(_ name: String) {
        Task { do { _ = try await invoke("window.journalNative.command(name)", arguments: ["name": name]) } catch { self.error = error.localizedDescription } }
    }
    func today() {
        guard loaded else { error = "Open a journal before adding an entry."; return }
        Task { do { _ = try await invoke("window.journalNative.today()") } catch { self.error = error.localizedDescription } }
    }
    func addDatedNote(date: Date, text: String) async -> Bool {
        guard loaded else { error = "Open a journal before adding a note."; return false }
        guard await saveDraft() else { return false }
        let components = Calendar.current.dateComponents([.year, .month, .day], from: date)
        let day = String(format: "%04d-%02d-%02d", components.year!, components.month!, components.day!)
        do {
            _ = try await invoke("return window.journalNative.appendText(day, text)", arguments: ["day": day, "text": text])
            return await saveDraft()
        } catch { self.error = error.localizedDescription; return false }
    }
    func toggleTypewriter() {
        typewriter.toggle()
        UserDefaults.standard.set(typewriter, forKey: "typewriter")
        Task { _ = try? await invoke("window.journalNative.typewriter(enabled)", arguments: ["enabled": typewriter]) }
    }
    func openJournal() {
        Task {
            guard await saveDraft() else { return }
            let panel = NSOpenPanel(); panel.allowedContentTypes = [.html]; panel.allowsMultipleSelection = false
            panel.message = "Open a journal as a local preview copy. The original file stays unchanged."
            guard await panel.begin() == .OK, let url = panel.url else { return }
            do {
                let html = try String(contentsOf: url, encoding: .utf8)
                // Keep an untouched import, separate from the editable experimental draft.
                let imports = storage.appendingPathComponent("Original imports", isDirectory: true)
                try FileManager.default.createDirectory(at: imports, withIntermediateDirectories: true)
                try html.write(to: imports.appendingPathComponent("\(UUID().uuidString)-\(url.lastPathComponent)"), atomically: true, encoding: .utf8)
                try disconnectBackup()
                sourceName = url.deletingPathExtension().lastPathComponent
                guard await load(html) else { return }; _ = await saveDraft()
                TimelineStore.shared.useNewJournal()
            } catch { self.error = error.localizedDescription }
        }
    }
    func exportCopy() {
        guard loaded else { error = "Open a journal before exporting a copy."; return }
        Task {
            guard await saveDraft() else { return }
            let panel = NSSavePanel(); panel.allowedContentTypes = [.html]; panel.nameFieldStringValue = "Journal — native preview.html"
            guard await panel.begin() == .OK, let url = panel.url else { return }
            do {
                guard let html = try await invoke("return window.journalNative.snapshot()") as? String else { return }
                try html.write(to: url, atomically: true, encoding: .utf8)
            } catch { self.error = error.localizedDescription }
        }
    }
    func showSample() { Task { guard await saveDraft() else { return }; do { try disconnectBackup() } catch { self.error = error.localizedDescription; return }; sourceName = "A little space to think"; guard await load(Self.sample) else { return }; _ = await saveDraft(); TimelineStore.shared.useNewJournal() } }
    static let sample = """
    <!doctype html><html><head><meta charset="utf-8"><title>Journal — sample</title></head><body>
    <h2>2026-10-28 Wednesday</h2><p>A walk before the day began. No headphones, no particular route. Just enough room for a few thoughts to settle.</p><p>I keep coming back to the idea that attention is a kind of practice. The small things are usually where it starts.</p>
    <h2>2026-10-30 Friday</h2><p>Spent the afternoon working through a piece of music. Less adding, more listening. The space between the sounds started to feel like part of the arrangement.</p><blockquote><p>Leave enough room to notice what is already there.</p></blockquote><p>Something to carry into next week.</p>
    <h2>2026-11-01 Sunday</h2><p>A slow Sunday. Coffee, a few pages, and an open window.</p><p>Made a little list of things I want to return to:</p><ul><li>The recording from last week</li><li>A longer walk by the water</li><li>Writing before checking anything else</li></ul>
    <h2>2026-11-02 Monday</h2><p>A quieter place to begin.</p><p>There is something nice about opening a page that doesn’t ask very much of you. A date, a little space, and the thought you came here to catch.</p><p>I want to make more room for that. Less arranging the day around the tools, more time inside the work itself.</p><p>This morning I went for a walk before sitting down. The light was soft, the streets were still finding their rhythm. I came back with a few ideas and no particular need to put them in order.</p><p>For now, it is enough to write them down.</p>
    </body></html>
    """
}

struct JournalWebView: NSViewRepresentable {
    let model: JournalModel
    let night: Bool
    static func applyAppearance(_ web: WKWebView, night: Bool) {
        web.appearance = NSAppearance(named: night ? .darkAqua : .aqua)
        // WKWebView may retain the OS media-query preference after an app-only
        // appearance change. Set display colors without changing journal HTML.
        let css = night
            ? ":root{color-scheme:dark!important;--fg:#e8e8ed!important;--muted:#98989d!important;--panel:#29292d!important;--surface:#29292d!important;--border:#38383d!important;--selection-bg:#34587c!important}.ProseMirror{color:#e8e8ed!important}.ProseMirror blockquote{color:#a1a1aa!important;border-color:#48484d!important}.ProseMirror a{color:#68a9ff!important}"
            : ":root{color-scheme:light!important;--fg:#242426!important;--muted:#86868b!important;--panel:#f5f5f7!important;--surface:#f5f5f7!important;--border:#e5e5e8!important;--selection-bg:#b8d8ff!important}.ProseMirror{color:#242426!important}.ProseMirror blockquote{color:#6e6e73!important;border-color:#d2d2d7!important}.ProseMirror a{color:#007aff!important}"
        let encoded = String(data: try! JSONSerialization.data(withJSONObject: [css]), encoding: .utf8)!
        web.evaluateJavaScript("(()=>{let s=document.getElementById('native-appearance');if(!s){s=document.createElement('style');s.id='native-appearance';document.head.appendChild(s)}if(s.textContent!==\(encoded)[0])s.textContent=\(encoded)[0]})()", completionHandler: nil)
    }
    func makeCoordinator() -> Coordinator { Coordinator(model) }
    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(context.coordinator, name: "journal")
        configuration.userContentController.addUserScript(WKUserScript(source: "window.addEventListener('error', e => window.webkit.messageHandlers.journal.postMessage({type:'error',message:e.message || 'An editor resource could not load.'}));", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = context.coordinator
        web.setValue(false, forKey: "drawsBackground")
        model.web = web
        if let resource = Bundle.main.url(forResource: "native", withExtension: "html", subdirectory: "Web") { web.loadFileURL(resource, allowingReadAccessTo: resource.deletingLastPathComponent()) }
        return web
    }
    func updateNSView(_ view: WKWebView, context: Context) {
        Self.applyAppearance(view, night: night)
    }
    @MainActor final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let model: JournalModel
        init(_ model: JournalModel) { self.model = model }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) { model.receive(message.body) }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { JournalWebView.applyAppearance(webView, night: JournalAppearance.shared.night) }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            let editorURL = Bundle.main.url(forResource: "native", withExtension: "html", subdirectory: "Web")
            if JournalNavigationPolicy.permits(url, editorURL: editorURL) { decisionHandler(.allow) }
            else {
                if action.navigationType == .linkActivated, let external = JournalNavigationPolicy.externalURL(url.absoluteString) { NSWorkspace.shared.open(external) }
                decisionHandler(.cancel)
            }
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { model.error = error.localizedDescription }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { model.error = "The editor stopped unexpectedly. Your last saved preview is kept locally. Reopen the app to recover it." }
    }
}

struct JournalView: View {
    @ObservedObject var model: JournalModel
    @ObservedObject private var appearance = JournalAppearance.shared
    @Environment(\.openWindow) private var openWindow
    @State private var columns: NavigationSplitViewVisibility = .all
    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            VStack(spacing: 12) {
                HStack(spacing: 7) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Search entries", text: $model.search).textFieldStyle(.plain).font(.system(size: 13))
                }.padding(9).background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 9)).padding(.horizontal, 16).padding(.top, 14)
                List(selection: Binding(get: { model.selected }, set: { model.choose($0) })) {
                    ForEach(model.months, id: \.self) { month in
                        Section(month) {
                            ForEach(model.filtered.filter { $0.month == month }) { entry in
                                HStack(alignment: .top, spacing: 12) {
                                    Text(entry.day).font(.system(size: 22, weight: .regular, design: .rounded)).foregroundStyle(.secondary).frame(width: 30, alignment: .trailing).padding(.top, 1)
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(entry.weekday).font(.system(size: 13, weight: .medium))
                                        Text(entry.preview.isEmpty ? "A new page" : entry.preview).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(2)
                                    }
                                }.padding(.vertical, 7).tag(entry.id)
                            }
                        }
                    }
                }.listStyle(.sidebar)
                HStack { Text("\(model.entries.count) entries"); Spacer(); Button(action: model.openJournal) { Image(systemName: "folder") }.buttonStyle(.plain).help("Open journal…") }.font(.system(size: 11)).foregroundStyle(.secondary).padding(.horizontal, 20).padding(.bottom, 16)
            }.navigationTitle("journal").navigationSplitViewColumnWidth(min: 230, ideal: 270, max: 340)
        } detail: {
            VStack(spacing: 0) {
                if !model.focus { VStack(alignment: .leading, spacing: 9) {
                    Text(model.currentEntry?.parsedDate?.formatted(.dateTime.year()) ?? "JOURNAL").font(.system(size: 12, weight: .medium)).foregroundStyle(.tertiary)
                    Text(model.currentEntry?.title ?? "Your journal").font(.system(size: 30, weight: .semibold)).tracking(-0.7).textSelection(.enabled)
                    HStack(spacing: 6) { Text("\(model.words.formatted()) words") }.font(.system(size: 12)).foregroundStyle(.secondary)
                }.frame(maxWidth: 690, alignment: .leading).frame(maxWidth: .infinity).padding(.horizontal, 44).padding(.top, 42).padding(.bottom, 29) }
                JournalWebView(model: model, night: appearance.night).frame(maxWidth: .infinity, maxHeight: .infinity)

            }.background(Color(nsColor: .textBackgroundColor))
            .overlay(alignment: .bottom) {
                if model.formatting {
                    HStack(spacing: 4) {
                        formatButton("bold", "Bold", "bold")
                        formatButton("italic", "Italic", "italic")
                        formatButton("underline", "Underline", "underline")
                        Divider().frame(height: 18).padding(.horizontal, 5)
                        formatButton("list.bullet", "Bulleted list", "bulletList")
                        formatButton("list.number", "Numbered list", "orderedList")
                        formatButton("text.quote", "Quote", "blockquote")
                    }.buttonStyle(.plain).padding(8).glassEffect(.regular, in: .capsule).padding(.bottom, 44)
                }
            }
        }
        .navigationTitle("journal")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button(action: model.today) { Label("New Note", systemImage: "square.and.pencil") }.help("Go to today or begin a new entry")
                AppearanceButton()
                Button { openWindow(id: "timeline") } label: { Label("Recurring themes", systemImage: "point.3.connected.trianglepath.dotted") }.help("Explore recurring themes over time")
                Button { model.addingNote = true } label: { Label("Add dated note", systemImage: "calendar.badge.plus") }.help("Paste a note for any date")
                Button { model.formatting.toggle() } label: { Label("Formatting", systemImage: "textformat") }.help("Text formatting")
                Button { model.toggleTypewriter() } label: { Label(model.typewriter ? "Typewriter on" : "Typewriter off", systemImage: model.typewriter ? "text.line.first.and.arrowtriangle.forward" : "text.alignleft") }.help(model.typewriter ? "Turn typewriter scrolling off" : "Keep the typing line centered")
                Button { withAnimation(.easeInOut(duration: 0.2)) { model.focus.toggle(); columns = model.focus ? .detailOnly : .all } } label: { Label("Focus", systemImage: model.focus ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right") }.help("Toggle focus")
                Menu {
                    Button("Open journal…", systemImage: "folder", action: model.openJournal)
                    Button("Save Journal To…", systemImage: "doc", action: model.saveJournalTo)
                    Button("Add dated note…", systemImage: "calendar.badge.plus") { model.addingNote = true }
                    Button("Export a copy…", systemImage: "square.and.arrow.up", action: model.exportCopy)
                    Divider()
                    Toggle("Typewriter mode", isOn: Binding(get: { model.typewriter }, set: { _ in model.toggleTypewriter() }))
                    Button("Show sample journal", action: model.showSample)
                } label: { Label("More", systemImage: "ellipsis") }
            }
        }
        .frame(minWidth: 650, minHeight: 480)
        .sheet(isPresented: $model.addingNote) { DatedNoteSheet(model: model) }
        .alert("Journal", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) { Button("OK") { model.error = nil } } message: { Text(model.error ?? "") }
    }
    func formatButton(_ icon: String, _ title: String, _ command: String) -> some View {
        Button { model.command(command) } label: { Image(systemName: icon).font(.system(size: 14, weight: .medium)).frame(width: 34, height: 30).contentShape(Rectangle()) }.help(title).accessibilityLabel(title)
    }
}

struct DatedNoteSheet: View {
    @ObservedObject var model: JournalModel
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var text = ""
    @State private var saving = false
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Add dated note").font(.title2.weight(.semibold))
            DatePicker("Date", selection: $date, displayedComponents: .date).datePickerStyle(.field)
            VStack(alignment: .leading, spacing: 8) {
                Text("Text").font(.system(size: 13, weight: .medium))
                TextEditor(text: $text).font(.body).scrollContentBackground(.hidden)
                    .padding(10).background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 9))
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(.separator, lineWidth: 0.5))
                    .accessibilityLabel("Note text").frame(minHeight: 260)
            }
            Text("Adds to the end of that day’s entry, or creates one if needed.").font(.caption).foregroundStyle(.secondary)
            HStack {
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                if saving { ProgressView().controlSize(.small) }
                Button("Add to journal") {
                    saving = true
                    Task { if await model.addDatedNote(date: date, text: text) { dismiss() }; saving = false }
                }.keyboardShortcut(.defaultAction).buttonStyle(.glassProminent).disabled(saving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }.padding(26).frame(width: 560).disabled(saving)
    }
}

/// One close operation owns save failure feedback. Autosave alerts must not
/// race a native close sheet or re-enter AppKit's termination callback.
@MainActor enum JournalCloseCoordinator {
    static func mayClose(model: JournalModel, confirmLocalCopy: () async -> Bool) async -> Bool {
        model.saveTask?.cancel()
        model.suppressSaveAlerts = true
        model.error = nil
        defer { model.suppressSaveAlerts = false }
        if await model.saveDraft() { return true }
        if model.localRecoverySaved { return await confirmLocalCopy() }
        // No safe local copy: refuse closing and expose the actual failure.
        model.error = model.lastSaveFailure ?? "The journal could not be saved. The window has been kept open."
        return false
    }
}

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var closing = false
    var terminationPending = false
    var windowClosePending: Set<ObjectIdentifier> = []
    func applicationDidFinishLaunching(_ notification: Notification) {
        JournalAppearance.shared.apply()
        // Use the original transparent artwork directly in the Dock rather
        // than the system's compatibility tile for legacy ICNS assets.
        if let url = Bundle.main.url(forResource: "Journal", withExtension: "icns"), let icon = NSImage(contentsOf: url) {
            NSApp.applicationIconImage = icon
        }
        NSApp.setActivationPolicy(.regular); NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.main.async { for window in NSApp.windows { window.delegate = self } }
        _ = TimelineStore.shared
    }
    private func allowLocalOnlyClose(_ action: String, parent: NSWindow?) async -> Bool {
        let alert = NSAlert()
        alert.messageText = "The journal file could not be updated"
        alert.informativeText = "Your latest writing was saved in the local recovery draft. You can choose a working destination with Save Journal To…, or \(action.lowercased()) now and recover the local draft next time."
        alert.addButton(withTitle: "\(action) with Local Copy")
        alert.addButton(withTitle: "Cancel")
        // A normal app with its main window closed still needs a nonblocking
        // confirmation host. Never nest runModal inside terminateLater.
        let temporaryHost = parent == nil
        let host = parent ?? NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 120), styleMask: [.titled], backing: .buffered, defer: false)
        if temporaryHost { host.title = "journal"; host.center(); host.makeKeyAndOrderFront(nil) }
        return await withCheckedContinuation { continuation in
            // Let SwiftUI finish dismissing any previous save-error alert first.
            DispatchQueue.main.async {
                if let sheet = host.attachedSheet { host.endSheet(sheet, returnCode: .cancel) }
                alert.beginSheetModal(for: host) { response in
                    if temporaryHost { host.close() }
                    continuation.resume(returning: response == .alertFirstButtonReturn)
                }
            }
        }
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminationPending else { return .terminateLater }
        guard windowClosePending.isEmpty else { return .terminateCancel }
        terminationPending = true
        let parent = NSApp.mainWindow ?? NSApp.keyWindow?.sheetParent ?? NSApp.keyWindow
        Task {
            let allowed = await JournalCloseCoordinator.mayClose(model: .shared) { await self.allowLocalOnlyClose("Quit", parent: parent) }
            terminationPending = false
            sender.reply(toApplicationShouldTerminate: allowed)
        }
        return .terminateLater
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if closing { return true }
        let identity = ObjectIdentifier(sender)
        guard !terminationPending, windowClosePending.isEmpty else { return false }
        windowClosePending.insert(identity)
        Task {
            let allowed = await JournalCloseCoordinator.mayClose(model: .shared) { await self.allowLocalOnlyClose("Close", parent: sender) }
            windowClosePending.remove(identity)
            if allowed { closing = true; sender.close(); closing = false }
        }
        return false
    }
}

#if !JOURNAL_MODEL_TESTS
@main struct JournalNativeApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var appearance = JournalAppearance.shared
    var body: some Scene {
        Window("journal", id: "main") { JournalView(model: .shared).preferredColorScheme(appearance.night ? .dark : .light) }
            .defaultSize(width: 1180, height: 800)
            .windowToolbarStyle(.unified)
            .commands {
                CommandGroup(replacing: .newItem) {
                    Button("Open journal…", action: JournalModel.shared.openJournal).keyboardShortcut("o")
                    Button("Today", action: JournalModel.shared.today).keyboardShortcut("n")
                    Button("Add dated note…") { JournalModel.shared.addingNote = true }.keyboardShortcut("n", modifiers: [.command, .shift])
                    Button("Save Journal") { Task { await JournalModel.shared.saveDraft() } }.keyboardShortcut("s")
                    Button("Save Journal To…", action: JournalModel.shared.saveJournalTo)
                    Button("Export a copy…", action: JournalModel.shared.exportCopy).keyboardShortcut("s", modifiers: [.command, .shift])
                }
                CommandMenu("Format") {
                    Button("Bold") { JournalModel.shared.command("bold") }.keyboardShortcut("b")
                    Button("Italic") { JournalModel.shared.command("italic") }.keyboardShortcut("i")
                    Button("Underline") { JournalModel.shared.command("underline") }.keyboardShortcut("u")
                }
            }
        Window("Thought Timeline", id: "timeline") { ThoughtTimelineView().preferredColorScheme(appearance.night ? .dark : .light) }
            .defaultSize(width: 1200, height: 800)
            .windowToolbarStyle(.unified)
    }
}

#endif
