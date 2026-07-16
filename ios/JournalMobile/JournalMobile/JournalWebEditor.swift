import SwiftUI
import WebKit

struct EditorCommand: Equatable {
    let id = UUID()
    let name: String
}

// The desktop journal saves standard HTML. A small WebKit editor lets the iOS
// app work with that exact same HTML rather than translating it into a second
// document format that could drift from the desktop version.
struct JournalWebEditor: UIViewRepresentable {
    let html: String
    let command: EditorCommand?
    let onChange: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onChange: onChange)
    }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "journalChange")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.keyboardDismissMode = .interactive
        webView.loadHTMLString(Self.editorPage, baseURL: nil)
        context.coordinator.webView = webView
        context.coordinator.pendingHTML = html
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onChange = onChange

        if context.coordinator.lastAppliedHTML != html {
            context.coordinator.apply(html: html, to: webView)
        }

        guard let command, context.coordinator.lastCommandID != command.id else { return }
        context.coordinator.lastCommandID = command.id
        context.coordinator.apply(command: command.name, to: webView)
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "journalChange")
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        weak var webView: WKWebView?
        var onChange: (String) -> Void
        var lastAppliedHTML = ""
        var pendingHTML: String?
        var lastCommandID: UUID?

        init(onChange: @escaping (String) -> Void) {
            self.onChange = onChange
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "journalChange", let html = message.body as? String else { return }
            lastAppliedHTML = html
            onChange(html)
        }

        func apply(html: String, to webView: WKWebView) {
            guard webView.url != nil else {
                pendingHTML = html
                return
            }

            lastAppliedHTML = html
            pendingHTML = nil
            webView.evaluateJavaScript("window.journal.setHTML(\(jsonString(html)));", completionHandler: nil)
        }

        func apply(command: String, to webView: WKWebView) {
            webView.evaluateJavaScript("window.journal.command(\(jsonString(command)));", completionHandler: nil)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            if let pendingHTML {
                apply(html: pendingHTML, to: webView)
            }
        }

        private func jsonString(_ value: String) -> String {
            let data = try? JSONSerialization.data(withJSONObject: [value])
            let array = String(data: data ?? Data("[\"\"]".utf8), encoding: .utf8) ?? "[\"\"]"
            return String(array.dropFirst().dropLast())
        }
    }

    private static let editorPage = """
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
        <style>
          :root { color-scheme: light dark; }
          * { box-sizing: border-box; }
          html, body { min-height: 100%; margin: 0; }
          body {
            padding: 28px 22px 96px;
            color: light-dark(#0d0d0d, #ffffff);
            background: transparent;
            font: 17px/1.8 "IBM Plex Mono", "Courier New", monospace;
            caret-color: light-dark(#0d0d0d, #ffffff);
            -webkit-font-smoothing: antialiased;
          }
          body:focus { outline: none; }
          body:empty::before { content: "start writing"; color: #888076; }
          h1 { color: #2f6fed; font-size: 30px; font-weight: 500; letter-spacing: -0.04em; }
          h2 { font-size: 21px; font-weight: 500; margin-top: 1.8em; }
          h3 { font-size: 18px; font-weight: 500; margin-top: 1.5em; }
          p { margin: 0 0 1em; }
          ul, ol { padding-left: 1.5em; margin: 0 0 1em; }
          blockquote { margin: 0 0 1em; padding-left: 12px; border-left: 2px solid #2f6fed; color: #888076; }
          code { padding: 1px 4px; background: rgba(47, 111, 237, 0.12); font-size: 0.88em; }
          hr { margin: 1.5em 0; border: 0; border-top: 1px solid rgba(13, 13, 13, 0.18); }
          ::selection { background: rgba(47, 111, 237, 0.2); }
          @media (prefers-color-scheme: dark) {
            h1 { color: #78a9ff; }
            blockquote { border-left-color: #78a9ff; }
            ::selection { background: rgba(120, 169, 255, 0.26); }
          }
        </style>
      </head>
      <body contenteditable="true" spellcheck="false" autocorrect="off" autocapitalize="off"></body>
      <script>
        const body = document.body;
        let inputTimer;
        const notify = () => {
          clearTimeout(inputTimer);
          inputTimer = setTimeout(() => window.webkit.messageHandlers.journalChange.postMessage(body.innerHTML), 120);
        };
        body.addEventListener('input', notify);
        body.addEventListener('blur', () => window.webkit.messageHandlers.journalChange.postMessage(body.innerHTML));

        window.journal = {
          setHTML(html) { body.innerHTML = html || '<p><br></p>'; },
          command(name) {
            if (name === 'today') {
              const today = new Date();
              const iso = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
              const existing = [...body.querySelectorAll('h2')].find((heading) => heading.textContent.includes(iso));
              if (existing) {
                existing.scrollIntoView({ block: 'center' });
                const range = document.createRange();
                range.selectNodeContents(existing);
                range.collapse(false);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                body.focus();
                return;
              }
              const weekday = today.toLocaleDateString('en-AU', { weekday: 'long' });
              body.insertAdjacentHTML('beforeend', `<h2>${iso} - ${weekday}</h2><p><br></p>`);
              notify();
              body.lastElementChild?.scrollIntoView({ block: 'center' });
              body.focus();
              return;
            }
            const commands = {
              heading1: ['formatBlock', false, 'h1'],
              heading2: ['formatBlock', false, 'h2'],
              bold: ['bold', false, null],
              italic: ['italic', false, null],
              bulletList: ['insertUnorderedList', false, null],
              orderedList: ['insertOrderedList', false, null],
            };
            const command = commands[name];
            if (!command) return;
            body.focus();
            document.execCommand(...command);
            notify();
          }
        };
      </script>
    </html>
    """
}
