import Foundation

@main struct PersistenceTests {
    @MainActor static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("journal-persistence-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        var count = 0
        func check(_ condition: Bool, _ message: String) {
            precondition(condition, message); count += 1
        }
        func fixture(_ name: String, draft: String?, destination: String?) throws -> (URL, URL) {
            let storage = root.appendingPathComponent(name)
            try FileManager.default.createDirectory(at: storage, withIntermediateDirectories: true)
            let target = root.appendingPathComponent(name + ".html")
            if let draft { try draft.write(to: storage.appendingPathComponent("preview-draft.html"), atomically: true, encoding: .utf8) }
            if let destination {
                try destination.write(to: target, atomically: true, encoding: .utf8)
                try target.path.write(to: storage.appendingPathComponent("backup-path.txt"), atomically: true, encoding: .utf8)
            }
            return (storage, target)
        }
        let old = "<html><body><p>Old journal 🍃</p></body></html>"
        let newer = "<html><body><p>New journal 日本語</p></body></html>"
        let (missingStorage, original) = try fixture("missing", draft: nil, destination: old)
        let missing = JournalDiskStore(storage: missingStorage)
        check(try missing.initialHTML(sample: "SAMPLE") == old, "Missing local draft must recover the linked journal")
        check(try String(contentsOf: original, encoding: .utf8) == old, "Recovery must not write sample to destination")
        check(try String(contentsOf: missing.draftURL, encoding: .utf8) == old, "Recovered journal must get a local safety copy")

        let (emptyStorage, emptyTarget) = try fixture("empty", draft: "", destination: old)
        do { _ = try JournalDiskStore(storage: emptyStorage).initialHTML(sample: "SAMPLE"); preconditionFailure("Empty recovery accepted") } catch { count += 1 }
        check(try String(contentsOf: emptyTarget, encoding: .utf8) == old, "Empty recovery must not replace destination")
        let (invalidStorage, _) = try fixture("invalid", draft: nil, destination: old)
        try Data([0xff, 0xfe, 0x00]).write(to: invalidStorage.appendingPathComponent("preview-draft.html"))
        do { _ = try JournalDiskStore(storage: invalidStorage).initialHTML(sample: "SAMPLE"); preconditionFailure("Invalid UTF8 accepted") } catch { count += 1 }

        let (conflictStorage, conflictTarget) = try fixture("conflict", draft: newer, destination: old)
        let conflict = JournalDiskStore(storage: conflictStorage)
        check(try conflict.initialHTML(sample: "SAMPLE") == newer, "Divergence must preserve local writing")
        check(conflict.hasConflict, "Divergence must be surfaced")
        do { try conflict.writeDestination(newer); preconditionFailure("Conflicting file overwritten") } catch { count += 1 }
        check(try String(contentsOf: conflictTarget, encoding: .utf8) == old, "Conflicting destination remains untouched")

        let (changedStorage, changedTarget) = try fixture("changed", draft: old, destination: old)
        let changed = JournalDiskStore(storage: changedStorage)
        _ = try changed.initialHTML(sample: "SAMPLE")
        try newer.write(to: changedTarget, atomically: true, encoding: .utf8)
        do { try changed.writeDestination(old); preconditionFailure("External edit overwritten") } catch { count += 1 }
        check(try String(contentsOf: changedTarget, encoding: .utf8) == newer, "External edit must survive")
        try changed.selectDestination(changedTarget, html: old, sourceName: "Synthetic")
        try changed.writeDestination(newer)
        check(try String(contentsOf: changedTarget, encoding: .utf8) == newer, "Explicit replacement should establish a fresh baseline")
        let permissions = try FileManager.default.attributesOfItem(atPath: changed.draftURL.path)[.posixPermissions] as! NSNumber
        check(permissions.intValue == 0o600, "Recovery writing must be private")
        let directoryPermissions = try FileManager.default.attributesOfItem(atPath: changedStorage.path)[.posixPermissions] as! NSNumber
        check(directoryPermissions.intValue == 0o700, "Recovery directory must be private")

        let (asyncStorage, _) = try fixture("async", draft: old, destination: nil)
        let model = JournalModel(storage: asyncStorage)
        model.ready = true; model.loaded = true
        var replies: [CheckedContinuation<Any?, Error>] = []
        model.invokeOverride = { _, _ in try await withCheckedThrowingContinuation { replies.append($0) } }
        let first = Task { await model.saveDraft() }
        while replies.count < 1 { await Task.yield() }
        let second = Task { await model.saveDraft() }
        while replies.count < 2 { await Task.yield() }
        replies[1].resume(returning: newer); check(await second.value, "Newer save failed")
        replies[0].resume(returning: old); check(await first.value, "Older completed save should be harmless")
        check(try String(contentsOf: model.disk.draftURL, encoding: .utf8) == newer, "Older asynchronous snapshot overwrote newer writing")

        // A superseded failure must not overwrite the latest save's status.
        replies.removeAll()
        let third = Task { await model.saveDraft() }
        while replies.count < 1 { await Task.yield() }
        let fourth = Task { await model.saveDraft() }
        while replies.count < 2 { await Task.yield() }
        replies[1].resume(returning: newer); _ = await fourth.value
        replies[0].resume(throwing: NSError(domain: "Synthetic", code: 1))
        check(await third.value, "An old snapshot failure must not supersede a newer successful save")
        check(model.status == "Saved locally", "Stale snapshot failure changed successful save status")

        let (loadStorage, loadTarget) = try fixture("load-failure", draft: "", destination: old)
        let unLoaded = JournalModel(storage: loadStorage); unLoaded.ready = true
        var snapshotCalled = false
        unLoaded.invokeOverride = { _, _ in snapshotCalled = true; return "SAMPLE" }
        _ = await unLoaded.saveDraft()
        check(!snapshotCalled, "Loading editor must never be saved")
        check(!(await unLoaded.addDatedNote(date: Date(), text: "Early note")), "Loading editor must not accept a note that recovery would overwrite")
        unLoaded.today()
        check(!snapshotCalled, "Loading editor must not create an early day that recovery would overwrite")
        check(try String(contentsOf: loadTarget, encoding: .utf8) == old, "Failed loading must preserve linked file")

        let (startupStorage, startupTarget) = try fixture("model-startup", draft: nil, destination: old)
        let startupModel = JournalModel(storage: startupStorage); startupModel.ready = true
        var loadedHTML = ""
        var startupSnapshots = 0
        startupModel.invokeOverride = { script, args in
            if script.contains("snapshot") { startupSnapshots += 1; return "SAMPLE" }
            if script.contains(".load(") { loadedHTML = args["html"] as? String ?? "" }
            return nil
        }
        await startupModel.recoverInitial()
        check(startupModel.loaded && loadedHTML == old, "Actual model must recover source into editor")
        check(startupSnapshots == 0, "Startup must not mirror a stale snapshot into destination")
        check(try String(contentsOf: startupTarget, encoding: .utf8) == old, "Model startup must leave linked journal untouched")
        await unLoaded.recoverInitial()
        _ = await unLoaded.saveDraft()
        check(!snapshotCalled && !unLoaded.loaded, "Recovery failure must keep editor unsaveable")

        let (switchStorage, _) = try fixture("switch", draft: old, destination: nil)
        let switchModel = JournalModel(storage: switchStorage); switchModel.ready = true; switchModel.loaded = true
        var staleReply: CheckedContinuation<Any?, Error>?
        switchModel.invokeOverride = { script, _ in
            if script.contains("snapshot") { return try await withCheckedThrowingContinuation { staleReply = $0 } }
            return nil
        }
        let staleSave = Task { await switchModel.saveDraft() }
        while staleReply == nil { await Task.yield() }
        _ = await switchModel.load(newer)
        staleReply!.resume(returning: old)
        check(!(await staleSave.value), "Previous-document save must be discarded after a journal switch")
        switchModel.invokeOverride = { _, _ in newer }
        _ = await switchModel.saveDraft()
        check(try String(contentsOf: switchModel.disk.draftURL, encoding: .utf8) == newer, "New document must save after invalidating an old request")

        let (failureStorage, failureTarget) = try fixture("model-destination-failure", draft: old, destination: old)
        let failureModel = JournalModel(storage: failureStorage); failureModel.ready = true; failureModel.loaded = true
        _ = try failureModel.disk.initialHTML(sample: "SAMPLE")
        try newer.write(to: failureTarget, atomically: true, encoding: .utf8)
        failureModel.invokeOverride = { _, _ in old + "<!-- local work -->" }
        check(!(await failureModel.saveDraft()), "A failed destination write must not report full success")
        check(failureModel.localRecoverySaved, "Destination failure must leave a safe local-close option")
        check(try String(contentsOf: failureModel.disk.draftURL, encoding: .utf8).contains("local work"), "Destination failure lost current local writing")
        check(try String(contentsOf: failureTarget, encoding: .utf8) == newer, "Model save overwrote externally changed destination")

        let (blockedStorage, blockedTarget) = try fixture("blocked-local", draft: old, destination: old)
        let blocked = JournalModel(storage: blockedStorage); blocked.ready = true; blocked.loaded = true
        _ = try blocked.disk.initialHTML(sample: "SAMPLE")
        try FileManager.default.removeItem(at: blocked.disk.draftURL)
        try FileManager.default.createDirectory(at: blocked.disk.draftURL, withIntermediateDirectories: false)
        blocked.invokeOverride = { _, _ in newer }
        check(!(await blocked.saveDraft()), "Local write failure must reject save")
        check(!blocked.localRecoverySaved, "Local write failure must not offer safe local-copy quit")
        check(try String(contentsOf: blockedTarget, encoding: .utf8) == old, "Destination must remain unchanged when local recovery fails")

        var confirmations = 0
        failureModel.error = "Previous save alert"
        let cancelledClose = await JournalCloseCoordinator.mayClose(model: failureModel) {
            confirmations += 1
            check(failureModel.suppressSaveAlerts && failureModel.error == nil, "Close confirmation must own feedback without overlapping SwiftUI save alerts")
            return false
        }
        check(!cancelledClose && confirmations == 1, "Cancelling local-copy close must keep app open")
        check(!failureModel.suppressSaveAlerts, "Cancelling close must restore ordinary autosave feedback")
        let acceptedClose = await JournalCloseCoordinator.mayClose(model: failureModel) { true }
        check(acceptedClose, "Accepting local-copy close should be allowed after recovery succeeds")
        check(failureModel.error == nil, "Local-copy close must not raise a competing SwiftUI alert")
        let blockedClose = await JournalCloseCoordinator.mayClose(model: blocked) { preconditionFailure("Unsafe local-copy close was offered") }
        check(!blockedClose && blocked.error != nil, "Failed local recovery must keep app open with actual failure")
        model.invokeOverride = { _, _ in newer }
        let cleanClose = await JournalCloseCoordinator.mayClose(model: model) { preconditionFailure("Clean close must not ask about a local-only copy") }
        check(cleanClose, "A clean save should close without confirmation")

        // A linked recovery draft would be changed by writeRecovery before
        // its destination-baseline check, falsely flagging every real edit.
        let (aliasStorage, _) = try fixture("self-alias", draft: old, destination: nil)
        let aliasStore = JournalDiskStore(storage: aliasStorage)
        do { try aliasStore.selectDestination(aliasStore.draftURL, html: newer, sourceName: "Alias"); preconditionFailure("Recovery self-link accepted") } catch { count += 1 }
        let alias = root.appendingPathComponent("recovery-alias.html")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: aliasStore.draftURL)
        do { try aliasStore.selectDestination(alias, html: newer, sourceName: "Alias"); preconditionFailure("Recovery symlink accepted") } catch { count += 1 }
        check(try String(contentsOf: aliasStore.draftURL, encoding: .utf8) == old, "Rejected self-link must leave recovery untouched")

        let timezone = NSTimeZone.default
        NSTimeZone.default = TimeZone(identifier: "America/Los_Angeles")!
        defer { NSTimeZone.default = timezone }
        let e = Entry(id: "test", date: "2026-11-06", words: 0, preview: "")
        check(Calendar.current.component(.day, from: e.parsedDate!) == 6, "Date-only headings must not shift to the previous day west of UTC")
        let invalid = Entry(id: "invalid", date: "2026-02-30", words: 0, preview: "")
        check(invalid.parsedDate == nil, "Impossible date must be rejected")
        let editor = URL(fileURLWithPath: "/synthetic/app/Web/native.html")
        check(JournalNavigationPolicy.permits(editor, editorURL: editor), "Initial editor navigation blocked")
        check(JournalNavigationPolicy.permits(URL(string: editor.absoluteString + "#heading")!, editorURL: editor), "Same-document fragment should remain available")
        check(!JournalNavigationPolicy.permits(URL(fileURLWithPath: "/synthetic/private.txt"), editorURL: editor), "Local file links must not replace the editor")
        check(!JournalNavigationPolicy.permits(URL(string: "https://example.invalid")!, editorURL: editor), "Remote navigation must not replace the editor")
        check(!JournalNavigationPolicy.permits(URL(string: "about:blank")!, editorURL: editor), "Blank navigation must not discard the editor")
        check(JournalNavigationPolicy.externalURL("https://example.invalid/video") != nil, "HTTPS bridge link rejected")
        check(JournalNavigationPolicy.externalURL("http://example.invalid") != nil, "HTTP bridge link rejected")
        check(JournalNavigationPolicy.externalURL("file:///private/synthetic.txt") == nil, "External bridge must reject local files")
        check(JournalNavigationPolicy.externalURL("javascript:alert(1)") == nil, "External bridge must reject script URLs")
        check(JournalNavigationPolicy.externalURL("https:") == nil, "External bridge must reject URLs without a host")
        print("\(count) native persistence assertions passed.")
    }
}
