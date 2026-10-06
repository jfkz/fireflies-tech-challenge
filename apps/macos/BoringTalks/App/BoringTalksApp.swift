import AppKit
import BoringTalksKit
import SwiftUI

@main
struct BoringTalksApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        MenuBarExtra {
            MenuContent(model: delegate.model)
        } label: {
            MenuBarLabel(recorder: delegate.model.recorder)
        }
        .menuBarExtraStyle(.window)

        Settings {
            SettingsView(model: delegate.model)
        }
    }
}

private struct MenuBarLabel: View {
    let recorder: MeetingRecorder

    var body: some View {
        Image(systemName: recorder.isRecording ? "record.circle.fill" : "bubble.left.and.text.bubble.right")
            .accessibilityLabel(recorder.isRecording ? "BoringTalks — recording" : "BoringTalks")
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = AppModel(config: AppConfig.resolve(arguments: CommandLine.arguments, defaults: .standard))
    private var liveWindow: LiveWindowController?
    private var previewPanel: NSPanel?

    func applicationWillFinishLaunching(_ notification: Notification) {
        // The sign-in callback (boringtalks://callback?code=…). An Apple Event handler
        // gets it even when no window is open, which a menu-bar app rarely has.
        NSAppleEventManager.shared().setEventHandler(
            self, andSelector: #selector(handleURL(_:reply:)),
            forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL)
        )
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if CommandLineTools.run(CommandLine.arguments, model: model) { return }

        let liveWindow = LiveWindowController(model: model)
        model.onLiveWindowChange = { [weak liveWindow] visible in liveWindow?.setVisible(visible) }
        self.liveWindow = liveWindow
        model.launch()

        let arguments = CommandLine.arguments
        if arguments.contains("--demo") {
            // Sample phrases in the live transcript window.
            model.recorder.live.showDemo()
            model.toggleLiveWindow()
        }
        #if DEBUG
        if arguments.contains("--debug-sign-in") { model.signIn() }
        if arguments.contains("--debug-sign-out") { model.signOut() }
        #endif
        if arguments.contains("--show-menu") {
            // The menu-bar window in an ordinary panel, for screenshots and QA.
            showMenuPreview()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        // A meeting still recording: keep what was captured so far.
        guard model.recorder.isRecording else { return }
        let semaphore = DispatchSemaphore(value: 0)
        Task { @MainActor in
            if let meeting = await model.recorder.stop() {
                await model.queue.enqueue(meeting)
            }
            semaphore.signal()
        }
        // Give the transcript a few seconds to finish; the audio is already on disk.
        let deadline = Date().addingTimeInterval(8)
        while semaphore.wait(timeout: .now()) == .timedOut, Date() < deadline {
            RunLoop.main.run(until: Date().addingTimeInterval(0.05))
        }
    }

    @objc private func handleURL(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        guard let text = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue, let url = URL(string: text) else { return }
        model.handle(url: url)
    }

    private func showMenuPreview() {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 340, height: 520),
                            styleMask: [.titled, .closable, .utilityWindow], backing: .buffered, defer: false)
        panel.title = "BoringTalks"
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.level = .floating
        panel.contentView = NSHostingView(rootView: MenuContent(model: model))
        panel.center()
        panel.orderFrontRegardless()
        previewPanel = panel
    }
}

/// Flags that do one job and exit instead of starting the menu-bar app.
@MainActor
enum CommandLineTools {
    /// Returns true when a tool ran (the app then exits when it is done).
    static func run(_ arguments: [String], model: AppModel) -> Bool {
        if let index = arguments.firstIndex(of: "--icon"), index + 1 < arguments.count {
            // `--icon <AppIcon.appiconset>`: draws the app icon in every size.
            do {
                try AppIconArt.write(to: URL(fileURLWithPath: arguments[index + 1]))
                exit(0)
            } catch {
                FileHandle.standardError.write(Data("couldn't write the icon: \(error.localizedDescription)\n".utf8))
                exit(1)
            }
        }
        if let options = FileTranscriber.Options(arguments: arguments) {
            Task {
                let status = await FileTranscriber.run(options, models: model.models)
                exit(status)
            }
            return true
        }
        return false
    }
}
