import AppKit
import BoringTalksKit
import SwiftUI

/// Report a Problem…: a message, what else is sent, Send or Save to File.
struct ReportView: View {
    @Bindable var reporter: ProblemReporter
    let appName: String
    let signedIn: Bool
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch reporter.state {
            case .sent(let reference):
                done("Sent. Thank you!", detail: "Reference \(reference).")
            case .saved(let url):
                done("Saved to \(url.deletingLastPathComponent().lastPathComponent).", detail: url.lastPathComponent)
            default:
                form
            }
        }
        .padding(16)
        .frame(width: 440)
    }

    @ViewBuilder
    private var form: some View {
        if let hang = reporter.hang {
            Label(hangText(hang), systemImage: "exclamationmark.triangle.fill")
                .font(.callout)
                .foregroundStyle(.orange)
                .fixedSize(horizontal: false, vertical: true)
        }
        Text("What happened?").font(.headline)
        TextEditor(text: $reporter.message)
            .font(.body)
            .frame(height: 120)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(.quaternary))
        Toggle("Include \(appName)'s log since it was opened", isOn: $reporter.includeLog)
        DisclosureGroup("What else is sent") {
            ScrollView {
                Text(diagnosticsText)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: 120)
        }
        .font(.callout)
        Text("Goes to the BoringTalks team with your account. No audio, transcripts or meeting titles.")
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        if case .failed(let message) = reporter.state {
            Label(message, systemImage: "xmark.octagon").font(.caption).foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
        }
        if !signedIn {
            Label("Sign in to send it, or save it to a file and send that.", systemImage: "person.crop.circle.badge.exclamationmark")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        HStack {
            Button("Save to File…") { reporter.saveToFile() }
            Spacer()
            if busy { ProgressView().controlSize(.small) }
            Button("Cancel", action: close)
                .keyboardShortcut(.cancelAction)
            Button("Send") { reporter.send() }
                .keyboardShortcut(.defaultAction)
                .disabled(!signedIn || busy)
        }
        .disabled(busy)
    }

    private func done(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: "checkmark.circle.fill").font(.headline).foregroundStyle(.green)
            Text(detail).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
            HStack {
                Spacer()
                Button("Close", action: close).keyboardShortcut(.defaultAction)
            }
        }
    }

    private var busy: Bool {
        reporter.state == .collecting || reporter.state == .sending
    }

    private var diagnosticsText: String {
        let lines = reporter.diagnostics.keys.sorted().map { "\($0): \(reporter.diagnostics[$0] ?? "")" }
        return lines.isEmpty ? "Collecting…" : lines.joined(separator: "\n")
    }

    private func hangText(_ hang: Hang) -> String {
        let when = hang.startedAt.formatted(date: .omitted, time: .shortened)
        return hang.recovered
            ? "\(appName) stopped responding for \(ProblemReport.describe(seconds: hang.seconds)) at \(when). Sending this helps find out why."
            : "\(appName) stopped responding at \(when) and was closed while stuck. Sending this helps find out why."
    }
}

/// The report window, opened from the menu.
@MainActor
final class ReportWindowController: NSObject, NSWindowDelegate {
    private var window: NSWindow?
    private let model: AppModel

    init(model: AppModel) {
        self.model = model
    }

    func show() {
        if window == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 440, height: 420),
                                  styleMask: [.titled, .closable], backing: .buffered, defer: false)
            window.title = "Report a Problem"
            window.isReleasedWhenClosed = false
            window.delegate = self
            window.contentViewController = NSHostingController(rootView: ReportHost(model: model) { [weak window] in window?.close() })
            window.center()
            self.window = window
        }
        NSApp.activate()
        window?.makeKeyAndOrderFront(nil)
    }
}

/// Reads the sign-in state from the model, so the window follows it.
private struct ReportHost: View {
    let model: AppModel
    let close: () -> Void

    var body: some View {
        let signedIn = if case .signedIn = model.auth { true } else { false }
        ReportView(reporter: model.reporter, appName: model.flavor.displayName, signedIn: signedIn, close: close)
    }
}
