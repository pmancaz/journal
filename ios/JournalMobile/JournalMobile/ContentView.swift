import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var documentStore: JournalDocumentStore
    @State private var showingDocumentPicker = false
    @State private var editorCommand: EditorCommand?

    var body: some View {
        Group {
            if documentStore.isDocumentOpen {
                editor
            } else {
                welcome
            }
        }
        .sheet(isPresented: $showingDocumentPicker) {
            JournalDocumentPicker { url in
                showingDocumentPicker = false
                documentStore.openDocument(at: url)
            }
        }
        .alert("journal changed in iCloud", isPresented: Binding(
            get: { documentStore.hasRemoteChange },
            set: { _ in }
        )) {
            Button("save local copy") {
                documentStore.saveLocalConflictCopy()
            }
            Button("reload remote version", role: .destructive) {
                documentStore.reloadRemoteVersion()
            }
            Button("keep writing", role: .cancel) {}
        } message: {
            Text("Another device changed this journal before your edits could be saved. Your iCloud file has not been overwritten.")
        }
    }

    private var editor: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                Button("open") {
                    showingDocumentPicker = true
                }

                Button("today") {
                    editorCommand = EditorCommand(name: "today")
                }
                .tint(.blue)

                Spacer(minLength: 8)

                Menu {
                    Button("heading 1") { sendCommand("heading1") }
                    Button("heading 2") { sendCommand("heading2") }
                    Divider()
                    Button("bold") { sendCommand("bold") }
                    Button("italic") { sendCommand("italic") }
                    Divider()
                    Button("bullet list") { sendCommand("bulletList") }
                    Button("numbered list") { sendCommand("orderedList") }
                } label: {
                    Text("format")
                }

                Button("refresh") {
                    documentStore.checkForRemoteChanges()
                }
            }
            .font(.system(.footnote, design: .monospaced))
            .textCase(.lowercase)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 16)
            .frame(height: 48)
            .overlay(alignment: .bottom) {
                Divider()
            }

            JournalWebEditor(
                html: documentStore.html,
                command: editorCommand,
                onChange: documentStore.updateEditorHTML
            )
            .background(Color(uiColor: .systemBackground))

            HStack(spacing: 6) {
                Rectangle()
                    .fill(documentStore.hasUnsavedChanges ? Color.orange : Color.green)
                    .frame(width: 5, height: 5)
                Text(documentStore.statusMessage)
                    .lineLimit(1)
                Spacer()
                Text(documentStore.documentName)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .font(.system(size: 10, design: .monospaced))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 16)
            .frame(height: 30)
            .overlay(alignment: .top) {
                Divider()
            }
        }
    }

    private var welcome: some View {
        VStack(spacing: 18) {
            Text("journal")
                .font(.system(size: 12, design: .monospaced))
                .textCase(.uppercase)
                .tracking(1.5)
                .foregroundStyle(.secondary)

            Text("choose your iCloud journal")
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(.secondary)

            Button("open file") {
                showingDocumentPicker = true
            }
            .font(.system(.footnote, design: .monospaced))
            .buttonStyle(.borderedProminent)
            .tint(.blue)

            Text("Select the same HTML file you use on your Mac. Journal keeps editing that file in place and saves changes back to iCloud Drive.")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 330)
        }
        .padding(24)
    }

    private func sendCommand(_ name: String) {
        editorCommand = EditorCommand(name: name)
    }
}
