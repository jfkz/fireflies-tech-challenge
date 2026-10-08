import AppKit
import AVFoundation
import BoringTalksKit
import SwiftUI

@main
struct BoringTalksApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        MenuBarExtra {
            MenuContent(model: delegate.model)
        } label: {
            MenuBarLabel(model: delegate.model, recorder: delegate.model.recorder)
        }
        .menuBarExtraStyle(.window)

        Settings {
            SettingsView(model: delegate.model)
        }
    }
}

private struct MenuBarLabel: View {
    let model: AppModel
    let recorder: MeetingRecorder

    var body: some View {
        if recorder.isRecording {
            Image(systemName: "record.circle.fill").accessibilityLabel("BoringTalks — recording")
        } else if let app = model.callOffer {
            // A call started: visible even with notifications off.
            Image(systemName: "phone.circle.fill").accessibilityLabel("BoringTalks — \(app) is in a call")
        } else {
            Image(systemName: "bubble.left.and.text.bubble.right").accessibilityLabel("BoringTalks")
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let model: AppModel = {
        let flavor = AppFlavor.of(.main)
        return AppModel(config: AppConfig.resolve(arguments: CommandLine.arguments, defaults: .standard, flavor: flavor), flavor: flavor)
    }()
    private var liveWindow: LiveWindowController?
    private var previewPanel: NSPanel?

    func applicationWillFinishLaunching(_ notification: Notification) {
        // The sign-in callback (boringtalks://callback?code=…, boringtalks-dev:// in BoringTalks Dev). An Apple Event handler
        // gets it even when no window is open, which a menu-bar app rarely has.
        NSAppleEventManager.shared().setEventHandler(
            self, andSelector: #selector(handleURL(_:reply:)),
            forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL)
        )
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if CommandLineTools.run(CommandLine.arguments, model: model) { return }

        model.notifier.setUp()
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
        // A fixed-size panel whose content never resizes the window: letting SwiftUI drive
        // the window size loops AppKit's constraint pass as the menu's content changes.
        let host = NSHostingController(rootView: ScrollView { MenuContent(model: model).padding(.bottom, 8) }
            .frame(width: 340, height: 560, alignment: .top))
        host.sizingOptions = []
        panel.contentViewController = host
        panel.setContentSize(NSSize(width: 340, height: 560))
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
        if let index = arguments.firstIndex(of: "--listen-test") {
            // `--listen-test [seconds]`: captures system audio and prints what arrives,
            // to check the capture on unusual output devices (Bluetooth headsets, interfaces).
            let seconds = index + 1 < arguments.count ? Double(arguments[index + 1]) ?? 6 : 6
            ListenTest.run(seconds: seconds)
            return true
        }
        if let index = arguments.firstIndex(of: "--mic-users") {
            // `--mic-users [seconds]`: prints the apps using a microphone whenever that changes,
            // and which call app each one counts as (for adding apps to CallApps).
            let seconds = index + 1 < arguments.count ? Double(arguments[index + 1]) ?? 30 : 30
            MicUsersTool.run(seconds: seconds, extra: model.preferences.extraCallApps)
            return true
        }
        if arguments.contains("--keychain-check") {
            // `--keychain-check`: which Keychain this build keeps the sign-in in (a release build
            // must say "data protection", or updating it will ask for Keychain access).
            let store = KeychainStore.usesDataProtection ? "data protection keychain" : "login keychain (no access-group entitlement)"
            FileHandle.standardOutput.write(Data("\(model.flavor.displayName) \(model.config.apiURL.absoluteString): \(store)\n".utf8))
            exit(0)
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

/// `--listen-test`: how much system audio arrives, at which rate, and how loud.
enum ListenTest {
    static func run(seconds: Double) {
        let capture = SystemAudioCapture()
        let lock = NSLock()
        var frames = 0
        var converted = 0
        var buffers = 0
        var peak: Float = 0
        var bufferRate: Double = 0
        var channels: AVAudioChannelCount = 0
        let converter = BufferConverter()
        do {
            try capture.start { buffer in
                let samples = converter.samples(buffer) ?? []
                let loudest = samples.map(abs).max() ?? 0
                lock.lock()
                frames += Int(buffer.frameLength)
                converted += samples.count
                buffers += 1
                peak = max(peak, loudest)
                bufferRate = buffer.format.sampleRate
                channels = buffer.format.channelCount
                lock.unlock()
            }
        } catch {
            FileHandle.standardError.write(Data("capture failed: \(error.localizedDescription)\n".utf8))
            exit(1)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
            capture.stop()
            lock.lock()
            let report: [String: Any] = [
                "seconds": seconds,
                "tapSampleRate": capture.tapFormat.mSampleRate,
                "tapChannels": capture.tapFormat.mChannelsPerFrame,
                "deviceSampleRate": capture.aggregateRate,
                "bufferSampleRate": bufferRate,
                "bufferChannels": channels,
                "buffers": buffers,
                "framesPerSecond": Double(frames) / seconds,
                "converted16kPerSecond": Double(converted) / seconds,
                "peak": peak,
            ]
            lock.unlock()
            if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
                FileHandle.standardOutput.write(data)
                FileHandle.standardOutput.write(Data("\n".utf8))
            }
            exit(0)
        }
    }
}

/// `--mic-users`: what the call detection sees.
@MainActor
enum MicUsersTool {
    private static let monitor = MicUsageMonitor()

    static func run(seconds: Double, extra: [String]) {
        let print = {
            let users = monitor.users.sorted().map { id in "\(id) → \(CallApps.identify(id, extra: extra)?.name ?? "not a call app")" }
            FileHandle.standardOutput.write(Data("\(Date().formatted(date: .omitted, time: .standard)) \(users.isEmpty ? "nobody is using a microphone" : users.joined(separator: ", "))\n".utf8))
        }
        monitor.onChange = print
        monitor.start()
        if monitor.users.isEmpty { print() }
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { exit(0) }
    }
}
