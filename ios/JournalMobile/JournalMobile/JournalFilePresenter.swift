import Foundation

// NSFilePresenter is Apple's way for an app to be told when another process
// or iCloud changes an external file that is currently open. It complements
// the foreground refresh so the journal stays current while the app is open.
final class JournalFilePresenter: NSObject, NSFilePresenter {
    let presentedItemURL: URL?
    let presentedItemOperationQueue: OperationQueue
    private let onChange: () -> Void

    init(url: URL, onChange: @escaping () -> Void) {
        presentedItemURL = url
        presentedItemOperationQueue = OperationQueue()
        presentedItemOperationQueue.maxConcurrentOperationCount = 1
        self.onChange = onChange
    }

    func presentedItemDidChange() {
        DispatchQueue.main.async { [onChange] in
            onChange()
        }
    }
}
