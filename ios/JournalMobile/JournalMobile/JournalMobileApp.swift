import SwiftUI

@main
struct JournalMobileApp: App {
    @StateObject private var documentStore = JournalDocumentStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(documentStore)
        }
    }
}
