import SwiftUI
import Charts
import Combine
import AppKit

struct ThoughtFinding: Decodable { var summary: String; var evidence: [String] }
struct ThoughtDay: Decodable, Identifiable {
    var date: String; var words: Int; var findings: [ThoughtFinding]
    var id: String { date }
}
struct ThoughtTheme: Decodable, Identifiable {
    var id: String; var label: String; var description: String; var color: String
    var firstSeen: String; var lastSeen: String; var days: Int
    var tint: Color {
        let value = UInt32(color, radix: 16) ?? 0x5B8FF9
        return Color(red: Double((value >> 16) & 255)/255, green: Double((value >> 8) & 255)/255, blue: Double(value & 255)/255)
    }
}
struct ThoughtOccurrence: Decodable, Identifiable {
    var date: String; var themeId: String; var share: Double; var quote: String; var similarity: Double
    var id: String { date + ":" + themeId }
    var day: Date { TimelineStore.day(date) ?? .distantPast }
}
struct ThoughtTimeline: Decodable {
    var version: Int; var sourceId: String; var sourceHash: String; var updatedAt: String; var model: String; var embeddingModel: String
    var themes: [ThoughtTheme]; var occurrences: [ThoughtOccurrence]; var days: [ThoughtDay]; var warnings: [String]
}
struct ThoughtStatus: Decodable {
    var sourceId: String; var runId: String; var pid: Int32; var running: Bool
    var message: String; var fraction: Double?; var startedAt: String; var updatedAt: String
    var error: Bool?; var warningCount: Int?; var cancelled: Bool?; var needsSync: Bool?
}

@MainActor final class TimelineStore: ObservableObject {
    static let shared = TimelineStore()
    @Published var timeline: ThoughtTimeline?
    @Published var progress: ThoughtStatus?
    @Published var error: String?
    @Published var sourceId = ""
    @Published var dailyEnabled = true
    @Published var hour = 12
    @Published var minute = 0
    @Published var scheduleInstalled = false
    @Published var selectedDate: String?
    @Published var selectedTheme: String?
    let root: URL
    let parent: URL
    private var timer: AnyCancellable?
    private var config: [String: Any] = [:]
    private let saveJournal: () async -> Bool
    private var process: Process?
    private var startTask: Task<Void, Never>?
    @Published private(set) var starting = false
    private var lastOutputDate: Date?
    private var lastStatusDate: Date?
    var running: Bool { starting || progress?.running == true }
    var theme: ThoughtTheme? { timeline?.themes.first { $0.id == selectedTheme } }
    var day: ThoughtDay? { timeline?.days.first { $0.date == selectedDate } }
    var selectedMatches: [ThoughtOccurrence] { timeline?.occurrences.filter { $0.date == selectedDate && (selectedTheme == nil || $0.themeId == selectedTheme) } ?? [] }
    var scheduleLabel: String { String(format: "%02d:%02d", hour, minute) }
    var agentURL: URL { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/com.pcjournal.native-preview.timeline.plist") }
    var pythonURL: URL { URL(fileURLWithPath: config["pythonPath"] as? String ?? parent.appendingPathComponent("TimelineRuntime/bin/python").path) }
    var workerURL: URL? { Bundle.main.url(forResource: "timeline_worker", withExtension: "py", subdirectory: "Timeline") }
    nonisolated static func day(_ value: String) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }
    init(parent: URL? = nil, saveJournal: (() async -> Bool)? = nil) {
        self.parent = parent ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("com.pcjournal.native-preview", isDirectory: true)
        self.saveJournal = saveJournal ?? { await JournalModel.shared.saveDraft() }
        root = self.parent.appendingPathComponent("Timeline", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
            if let data = try? Data(contentsOf: root.appendingPathComponent("config.json")), let values = try JSONSerialization.jsonObject(with: data) as? [String: Any] { config = values }
            sourceId = (try? String(contentsOf: self.parent.appendingPathComponent("journal-id.txt"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)) ?? UUID().uuidString
            dailyEnabled = config["dailyEnabled"] as? Bool ?? true
            hour = config["hour"] as? Int ?? 12; minute = config["minute"] as? Int ?? 0
            try persistConfig()
            refresh()
        } catch { self.error = error.localizedDescription }
        scheduleInstalled = FileManager.default.fileExists(atPath: agentURL.path)
        timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect().sink { [weak self] _ in self?.refresh() }
    }
    func persistConfig() throws {
        config["sourceId"] = sourceId
        config["sourcePath"] = parent.appendingPathComponent("preview-draft.html").path
        config["dailyEnabled"] = dailyEnabled; config["hour"] = hour; config["minute"] = minute
        let configURL = root.appendingPathComponent("config.json")
        try JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys]).write(to: configURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configURL.path)
        try sourceId.write(to: parent.appendingPathComponent("journal-id.txt"), atomically: true, encoding: .utf8)
    }
    func useNewJournal() {
        sourceId = UUID().uuidString; timeline = nil; selectedDate = nil; selectedTheme = nil; lastOutputDate = nil; lastStatusDate = nil
        do { try persistConfig() } catch { self.error = error.localizedDescription }
        refresh()
    }
    func refresh() {
        let statusURL = root.appendingPathComponent("status.json")
        let statusModified = try? statusURL.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
        if statusModified != lastStatusDate, let data = try? Data(contentsOf: statusURL), var value = try? JSONDecoder().decode(ThoughtStatus.self, from: data) {
            lastStatusDate = statusModified
            if value.running && kill(value.pid, 0) != 0 && errno == ESRCH { value.running = false; value.error = true; value.message = "The last sync stopped before completion. Sync now to continue." }
            if value.sourceId == sourceId { progress = value }
            else if value.running { value.message = "Updating the previous journal…"; progress = value }
            else { progress = nil }
        } else if var value = progress, value.running, kill(value.pid, 0) != 0 && errno == ESRCH {
            value.running = false; value.error = true; value.message = "The last sync stopped before completion. Sync now to continue."; progress = value
        }
        let output = root.appendingPathComponent("timeline-\(sourceId).json")
        let modified = try? output.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
        guard modified != lastOutputDate, let data = try? Data(contentsOf: output), let value = try? JSONDecoder().decode(ThoughtTimeline.self, from: data), value.sourceId == sourceId else { return }
        timeline = value; lastOutputDate = modified
        if selectedDate == nil || !value.days.contains(where: { $0.date == selectedDate }) { selectedDate = value.days.last?.date }
        if let selectedTheme, !value.themes.contains(where: { $0.id == selectedTheme }) { self.selectedTheme = nil }
    }
    func syncNow(date: String? = nil) {
        guard !running else { return }
        // Claim the action before awaiting the editor. Two rapid clicks used
        // to pass the guard, launch competing workers, then race their status.
        starting = true
        startTask = Task {
            defer { starting = false; startTask = nil }
            guard await saveJournal(), !Task.isCancelled else { return }
            do {
                guard let workerURL else { throw CocoaError(.fileNoSuchFile) }
                try persistConfig()
                let job = Process(); job.executableURL = pythonURL
                job.arguments = [workerURL.path, "--state-dir", root.path] + (date.map { ["--date", $0] } ?? [])
                var environment = ProcessInfo.processInfo.environment
                environment["HF_HUB_OFFLINE"] = "1"; environment["TRANSFORMERS_OFFLINE"] = "1"; environment["PYTHONUNBUFFERED"] = "1"
                job.environment = environment
                let logURL = root.appendingPathComponent("worker.log")
                if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: logURL.path)
                let log = try FileHandle(forWritingTo: logURL); try log.seekToEnd()
                job.standardOutput = log; job.standardError = log
                job.terminationHandler = { finished in
                    try? log.close()
                    Task { @MainActor in
                        if self.process === finished { self.process = nil }
                        self.refresh()
                    }
                }
                try job.run(); process = job
                progress = ThoughtStatus(sourceId: sourceId, runId: "starting", pid: job.processIdentifier, running: true, message: "Starting local analysis…", fraction: nil, startedAt: "", updatedAt: "")
            } catch { self.error = "Couldn’t start local analysis: \(error.localizedDescription)" }
        }
    }
    func stop() {
        startTask?.cancel()
        if let process, process.isRunning { process.terminate() }
        else if let progress, progress.running, ownsWorker(progress.pid) { kill(progress.pid, SIGTERM) }
    }
    private func ownsWorker(_ pid: Int32) -> Bool {
        guard let workerURL else { return false }
        let query = Process(); let pipe = Pipe(); query.executableURL = URL(fileURLWithPath: "/bin/ps")
        query.arguments = ["-p", String(pid), "-o", "command="]; query.standardOutput = pipe; query.standardError = FileHandle.nullDevice
        do { try query.run(); let data = pipe.fileHandleForReading.readDataToEndOfFile(); query.waitUntilExit()
            let command = String(decoding: data, as: UTF8.self)
            return command.contains(workerURL.path) && command.contains(root.path)
        } catch { return false }
    }
    func installSchedule() {
        let previousConfig = config
        let previousAgent = try? Data(contentsOf: agentURL)
        let previousInstalled = scheduleInstalled
        var changedAgent = false
        let label = "com.pcjournal.native-preview.timeline"
        let domain = "gui/\(getuid())"
        func launchctl(_ arguments: [String]) throws -> Int32 {
            let job = Process(); job.executableURL = URL(fileURLWithPath: "/bin/launchctl")
            job.arguments = arguments; job.standardOutput = FileHandle.nullDevice; job.standardError = FileHandle.nullDevice
            try job.run(); job.waitUntilExit(); return job.terminationStatus
        }
        do {
            guard (0..<24).contains(hour), (0..<60).contains(minute) else {
                throw NSError(domain: "JournalTimeline", code: 2, userInfo: [NSLocalizedDescriptionKey: "Choose a valid daily update time."])
            }
            // Validate before unloading a working schedule. Disabling remains
            // possible even if the model/runtime has since been removed.
            var data: Data?
            if dailyEnabled {
                guard let workerURL, FileManager.default.isExecutableFile(atPath: pythonURL.path) else {
                    throw NSError(domain: "JournalTimeline", code: 3, userInfo: [NSLocalizedDescriptionKey: "The local analysis runtime is missing. Restore it before enabling daily updates."])
                }
                let plist: [String: Any] = ["Label": label, "ProgramArguments": [pythonURL.path, workerURL.path, "--state-dir", root.path],
                                          "StartCalendarInterval": ["Hour": hour, "Minute": minute], "ProcessType": "Background", "Nice": 10,
                                          "StandardOutPath": root.appendingPathComponent("scheduled.log").path, "StandardErrorPath": root.appendingPathComponent("scheduled.log").path,
                                          "EnvironmentVariables": ["HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "PYTHONUNBUFFERED": "1"]]
                data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
            }
            _ = try launchctl(["bootout", "\(domain)/\(label)"]); changedAgent = true
            if let data {
                try FileManager.default.createDirectory(at: agentURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                try data.write(to: agentURL, options: .atomic)
                if try launchctl(["bootstrap", domain, agentURL.path]) != 0 {
                    throw NSError(domain: "JournalTimeline", code: 1, userInfo: [NSLocalizedDescriptionKey: "macOS could not enable the daily job."])
                }
            } else if FileManager.default.fileExists(atPath: agentURL.path) {
                try FileManager.default.removeItem(at: agentURL)
            }
            try persistConfig()
            scheduleInstalled = dailyEnabled
        } catch {
            var restored = true
            if changedAgent {
                _ = try? launchctl(["bootout", "\(domain)/\(label)"])
                if let previousAgent {
                    try? previousAgent.write(to: agentURL, options: .atomic)
                    restored = (try? launchctl(["bootstrap", domain, agentURL.path])) == 0
                } else { try? FileManager.default.removeItem(at: agentURL) }
            }
            config = previousConfig
            dailyEnabled = previousConfig["dailyEnabled"] as? Bool ?? true
            hour = previousConfig["hour"] as? Int ?? 12; minute = previousConfig["minute"] as? Int ?? 0
            scheduleInstalled = previousInstalled && restored
            try? persistConfig()
            self.error = error.localizedDescription + (restored ? "" : " The previous schedule could not be restarted. Its settings were preserved; enable it again when macOS is ready.")
        }
    }

}

struct ThoughtTimelineView: View {
    @ObservedObject var store = TimelineStore.shared
    @Environment(\.openWindow) private var openWindow
    @State private var range = 365
    @State private var scheduleVisible = false
    var visiblePoints: [ThoughtOccurrence] {
        guard let timeline = store.timeline else { return [] }
        let latest = timeline.occurrences.map(\.day).max() ?? .now
        let start = range == 0 ? Date.distantPast : Calendar.current.date(byAdding: .day, value: -range, to: latest)!
        return timeline.occurrences.filter { $0.day >= start }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Threads of thought").font(.system(size: 28, weight: .semibold)).tracking(-0.6)
                    Text("A bird’s-eye view of your journal.").font(.system(size: 14)).foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    Label("On this Mac", systemImage: "lock.shield").font(.system(size: 12, weight: .medium))
                    Text("Qwen3.5 9B · MiniLM").font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }.padding(.horizontal, 30).padding(.top, 27).padding(.bottom, 24)
            if store.running {
                VStack(alignment: .leading, spacing: 8) {
                    HStack { Text(store.progress?.message ?? "Working locally…"); Spacer(); Button("Stop", action: store.stop).buttonStyle(.borderless) }.font(.system(size: 12))
                    if let fraction = store.progress?.fraction { ProgressView(value: fraction) } else { ProgressView().controlSize(.small) }
                }.padding(.horizontal, 30).padding(.bottom, 18)
            }
            if let timeline = store.timeline {
                HStack {
                    Text("\(timeline.days.count) writing days  ·  \(timeline.themes.count) recurring threads").font(.system(size: 12)).foregroundStyle(.secondary)
                    Spacer()
                    Picker("Time range", selection: $range) { Text("3 months").tag(90); Text("Year").tag(365); Text("All").tag(0) }.labelsHidden().pickerStyle(.segmented).frame(width: 230)
                }.padding(.horizontal, 30).padding(.bottom, 20)
                HStack(alignment: .top, spacing: 0) {
                    VStack(alignment: .leading, spacing: 16) {
                        chart(timeline).frame(minHeight: 260, idealHeight: 390, maxHeight: .infinity)
                        Text("Each dot is a writing day. Larger dots mean more of that day’s writing matched the theme.").font(.system(size: 11)).foregroundStyle(.secondary).padding(.leading, 8)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(timeline.themes) { theme in
                                    Button { store.selectedTheme = store.selectedTheme == theme.id ? nil : theme.id } label: {
                                        HStack(spacing: 7) { Circle().fill(theme.tint).frame(width: 7, height: 7); Text(theme.label); Text("\(theme.days)").foregroundStyle(.secondary) }
                                            .font(.system(size: 11, weight: .medium)).padding(.horizontal, 11).padding(.vertical, 8)
                                            .background(store.selectedTheme == theme.id ? theme.tint.opacity(0.16) : Color.primary.opacity(0.04), in: .capsule)
                                    }.buttonStyle(.plain)
                                }
                            }
                        }.defaultScrollAnchor(.leading)
                    }.padding(.leading, 26).padding(.trailing, 24)
                    Divider()
                    inspector(timeline).frame(width: 285)
                }
                Divider().padding(.top, 20)
                HStack {
                    if let value = store.progress, !value.running { Label(value.message, systemImage: value.error == true ? "exclamationmark.circle" : "checkmark.circle").lineLimit(2) }
                    Spacer()
                    if let updated = updatedDate(timeline.updatedAt) { Text("Updated \(updated.formatted(date: .abbreviated, time: .shortened))") }
                    Text(store.dailyEnabled && store.scheduleInstalled ? "Daily at \(store.scheduleLabel) · local time" : "Daily sync off")
                }.font(.system(size: 11)).foregroundStyle(.secondary).padding(.horizontal, 30).padding(.vertical, 14)
            } else {
                Spacer()
                VStack(spacing: 18) {
                    Image(systemName: "point.3.connected.trianglepath.dotted").font(.system(size: 46, weight: .light)).foregroundStyle(.secondary)
                    Text("Your thinking, over time").font(.title2.weight(.semibold))
                    Text("Find recurring ideas, follow how they evolve, and return to the writing behind them.").foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 400)
                    if !store.running { Button("Build my timeline") { store.syncNow() }.buttonStyle(.glassProminent) }
                    Text("Runs locally. Your journal entries are never rewritten.").font(.caption).foregroundStyle(.tertiary)
                    if let value = store.progress, value.error == true { Text(value.message).font(.caption).foregroundStyle(.red).frame(maxWidth: 450) }
                }.frame(maxWidth: .infinity)
                Spacer()
            }
        }
        .background(Color(nsColor: .textBackgroundColor))
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                AppearanceButton()
                Button { store.syncNow() } label: { Label("Sync now", systemImage: "arrow.triangle.2.circlepath") }.disabled(store.running).help("Analyze new and changed writing locally")
                Button { scheduleVisible.toggle() } label: { Label("Daily schedule", systemImage: "clock") }.popover(isPresented: $scheduleVisible) { schedule.padding(22).frame(width: 310) }
            }
        }
        .frame(minWidth: 840, minHeight: 580)
        .alert("Thought timeline", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) { Button("OK") { store.error = nil } } message: { Text(store.error ?? "") }
    }
    func chart(_ timeline: ThoughtTimeline) -> some View {
        HStack(spacing: 16) {
            VStack(spacing: 0) {
                ForEach(timeline.themes) { theme in
                    Text(theme.label).font(.system(size: 11)).foregroundStyle(.secondary).multilineTextAlignment(.trailing).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing).lineLimit(3)
                }
            }.frame(width: 138).padding(.bottom, 24)
        Chart {
            ForEach(timeline.themes) { theme in
                RuleMark(y: .value("Thread", theme.id)).lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 5])).foregroundStyle(Color.primary.opacity(0.07))
            }
            ForEach(visiblePoints) { point in
                if let theme = timeline.themes.first(where: { $0.id == point.themeId }) {
                    PointMark(x: .value("Writing day", point.day), y: .value("Thread", theme.id))
                        .symbolSize(18 + point.share * 170).foregroundStyle(theme.tint)
                        .opacity(store.selectedTheme == nil || store.selectedTheme == point.themeId ? 0.75 : 0.12)
                        .accessibilityLabel(Text(theme.label))
                        .accessibilityValue(Text("\(displayDate(point.date)), \(Int(point.share * 100)) percent of the day’s writing"))
                }
            }
            if let selected = store.selectedDate, let date = TimelineStore.day(selected) { RuleMark(x: .value("Selected day", date)).foregroundStyle(Color.primary.opacity(0.18)).lineStyle(StrokeStyle(lineWidth: 1)) }
        }
        .chartYScale(domain: timeline.themes.map(\.id))
        .chartYAxis(.hidden)
        .chartXAxis { AxisMarks(values: .automatic(desiredCount: 6)) { _ in AxisGridLine().foregroundStyle(Color.primary.opacity(0.04)); AxisValueLabel(format: .dateTime.month(.abbreviated).year(.twoDigits)).font(.system(size: 10)) } }
        .chartOverlay { proxy in
            GeometryReader { geometry in
                Rectangle().fill(Color.clear).contentShape(Rectangle()).gesture(SpatialTapGesture().onEnded { value in
                    guard let frame = proxy.plotFrame else { return }
                    let origin = geometry[frame].origin
                    guard let date: Date = proxy.value(atX: value.location.x - origin.x) else { return }
                    let themeId: String? = proxy.value(atY: value.location.y - origin.y)
                    let theme = timeline.themes.first { $0.id == themeId }
                    let candidates = visiblePoints.filter { theme == nil || $0.themeId == theme?.id }
                    if let closest = candidates.min(by: { abs($0.day.timeIntervalSince(date)) < abs($1.day.timeIntervalSince(date)) }) {
                        store.selectedDate = closest.date; store.selectedTheme = closest.themeId
                    }
                })
            }
        }
        .accessibilityLabel("Recurring thought themes across writing dates")
        .accessibilityHint("Select a theme below, then choose a dated entry in the details panel.")
        }
    }
    func inspector(_ timeline: ThoughtTimeline) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let theme = store.theme {
                    HStack(spacing: 8) { Circle().fill(theme.tint).frame(width: 9, height: 9); Text(theme.label).font(.headline) }
                    Text(theme.description).font(.system(size: 12)).foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 5) {
                        Text("\(theme.days) writing days").fontWeight(.medium)
                        Text("First seen \(displayDate(theme.firstSeen))")
                        Text("Last seen \(displayDate(theme.lastSeen))")
                    }.font(.system(size: 11)).foregroundStyle(.secondary)
                    Button("Show all threads") { store.selectedTheme = nil }.font(.system(size: 11)).buttonStyle(.borderless)
                    Divider()
                }
                Text("A DAY IN YOUR THINKING").font(.system(size: 10, weight: .semibold)).foregroundStyle(.tertiary)
                Picker("Writing day", selection: Binding(get: { store.selectedDate ?? timeline.days.last?.date ?? "" }, set: { store.selectedDate = $0 })) {
                    ForEach(timeline.days.reversed()) { day in Text(displayDate(day.date)).tag(day.date) }
                }.labelsHidden().frame(maxWidth: .infinity)
                if let day = store.day {
                    Text("\(day.words.formatted()) words").font(.caption).foregroundStyle(.tertiary)
                    if day.findings.isEmpty {
                        Text("Theme matches are ready. Create a closer summary of this day when you want one.").font(.system(size: 12)).foregroundStyle(.secondary)
                        Button("Summarize this day") { store.syncNow(date: day.date) }.disabled(store.running).font(.system(size: 12))
                    } else {
                        ForEach(Array(day.findings.enumerated()), id: \.offset) { _, finding in Text(finding.summary).font(.system(size: 13)).lineSpacing(4) }
                    }
                    Divider()
                    Text("FROM YOUR WRITING").font(.system(size: 10, weight: .semibold)).foregroundStyle(.tertiary)
                    ForEach(store.selectedMatches) { match in
                        VStack(alignment: .leading, spacing: 7) {
                            Text(timeline.themes.first { $0.id == match.themeId }?.label ?? "Thread").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
                            Text(match.quote).font(.system(size: 12)).lineSpacing(3).textSelection(.enabled)
                        }
                    }
                    if store.selectedMatches.isEmpty {
                        Text("No close match to the current recurring themes on this day.").font(.system(size: 12)).foregroundStyle(.secondary)
                        ForEach(Array(Set(day.findings.flatMap(\.evidence))).sorted().prefix(3), id: \.self) { quote in Text(quote).font(.system(size: 12)).lineSpacing(3).textSelection(.enabled) }
                    }
                    Button { openWindow(id: "main"); JournalModel.shared.choose(JournalModel.shared.entries.first { $0.date == day.date }?.id) } label: { Label("Open journal entry", systemImage: "arrow.up.right") }.font(.system(size: 12)).buttonStyle(.borderless)
                }
                    Text("AI interpretation · theme matches are approximate").font(.system(size: 10)).foregroundStyle(.tertiary)
            }.padding(.horizontal, 22).padding(.bottom, 12)
        }
    }
    var schedule: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Daily timeline update").font(.headline)
            Toggle("Update automatically", isOn: $store.dailyEnabled)
            HStack {
                Text("Local time")
                Spacer()
                Picker("Hour", selection: $store.hour) { ForEach(0..<24) { Text(String(format: "%02d", $0)).tag($0) } }.labelsHidden().frame(width: 72)
                Text(":")
                Picker("Minute", selection: $store.minute) { ForEach(0..<60) { Text(String(format: "%02d", $0)).tag($0) } }.labelsHidden().frame(width: 72)
            }.disabled(!store.dailyEnabled)
            Text("Runs while you’re signed in, even with Journal closed. If the Mac is asleep, macOS runs the missed update after it wakes.").font(.caption).foregroundStyle(.secondary)
            Button("Save schedule") { store.installSchedule(); scheduleVisible = false }.buttonStyle(.glassProminent)
        }
    }
    func displayDate(_ value: String) -> String { TimelineStore.day(value)?.formatted(.dateTime.day().month(.abbreviated).year()) ?? value }
    func updatedDate(_ value: String) -> Date? { let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return formatter.date(from: value) }
}
