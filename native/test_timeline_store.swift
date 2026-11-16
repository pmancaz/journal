// Isolated main-actor regression for rapid Sync submissions and cancellation.
// Compile with -D JOURNAL_MODEL_TESTS and the native app sources.
import Foundation

@main struct TimelineStoreTests {
    @MainActor static func main() async throws {
        let parent = FileManager.default.temporaryDirectory.appendingPathComponent("journal-timeline-store-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: parent) }
        var saveCount = 0
        var pending: CheckedContinuation<Bool, Never>?
        let store = TimelineStore(parent: parent, saveJournal: {
            saveCount += 1
            return await withCheckedContinuation { pending = $0 }
        })
        store.syncNow()
        store.syncNow()
        precondition(store.running, "Sync must claim its action before awaiting editor save")
        for _ in 0..<100 where pending == nil { await Task.yield() }
        precondition(saveCount == 1, "Repeated Sync clicks must request only one snapshot")
        precondition(pending != nil)
        store.stop()
        pending?.resume(returning: true)
        for _ in 0..<100 where store.running { await Task.yield() }
        precondition(!store.running, "Stop while saving must cancel the pending launch")
        precondition(store.progress == nil, "A cancelled pending launch must not spawn a worker")
        let attributes = try FileManager.default.attributesOfItem(atPath: store.root.path)
        precondition((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700)
        print("TimelineStore rapid Sync, cancellation, and private state tests passed.")
    }
}
