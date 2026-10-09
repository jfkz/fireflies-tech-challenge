import BoringTalksKit
import SwiftUI

/// Settings, in tabs so the window stays short; a tab taller than the screen scrolls.
struct SettingsView: View {
    @Bindable var model: AppModel
    /// The tab last open (also `-settingsTab calls` on the command line, for screenshots).
    @AppStorage("settingsTab") private var tab = "transcription"

    var body: some View {
        TabView(selection: $tab) {
            Tab("Transcription", systemImage: "text.bubble", value: "transcription") { page { transcription } }
            Tab("Recording", systemImage: "waveform", value: "recording") { page { recording } }
            Tab("Calls", systemImage: "phone", value: "calls") { page { calls } }
            Tab("Account", systemImage: "person.crop.circle", value: "account") { page { account } }
        }
    }

    /// One tab: as tall as its content, at most as tall as the screen (then it scrolls).
    private func page(@ViewBuilder _ content: () -> some View) -> some View {
        Form { content() }
            .formStyle(.grouped)
            .frame(width: 480)
            .frame(maxHeight: Self.maxHeight)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var transcription: some View {
        @Bindable var preferences = model.preferences
        Section {
            Picker("Transcribe", selection: Binding(
                get: { model.preferences.transcribeOnMac },
                set: { model.setTranscribeOnMac($0) }
            )) {
                Text("On this Mac").tag(true)
                Text("Online, after the meeting").tag(false)
            }
            .pickerStyle(.radioGroup)
            Text(preferences.transcribeOnMac
                 ? "Parakeet v3 on the Neural Engine writes the transcript as you talk, for free. Only the text (and the audio, if you upload it) leaves this Mac."
                 : "Nothing is transcribed here: BoringTalks records you and the others on separate channels and uploads the audio, and the server transcribes it once the meeting is over, keeping “You” apart from the others. No live transcript, no speech model to download.")
                .font(.caption).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }

        Section("Speech model") {
            if preferences.transcribeOnMac {
                LabeledContent("Status", value: model.models.summary)
                ModelProgress(models: model.models)
                if case .failed = model.models.state {
                    Button("Try downloading again") {
                        Task { await model.models.prepare() }
                    }
                }
            } else {
                LabeledContent("Status", value: "Not needed while the server transcribes")
            }
            Picker("Language", selection: $preferences.language) {
                Text("Detect automatically").tag("")
                Divider()
                ForEach(ParakeetEngine.languages, id: \.code) { language in
                    Text(language.name).tag(language.code)
                }
            }
        }
    }

    @ViewBuilder private var recording: some View {
        @Bindable var preferences = model.preferences
        Section {
            Toggle("Keep Bluetooth headsets in high quality", isOn: $preferences.avoidBluetoothMic)
            caption("Recording with a Bluetooth headset's microphone switches the headset to call quality. With this on, “You” is recorded with the Mac's own microphone instead.")
            Toggle("Upload meeting audio", isOn: $preferences.uploadAudio)
                .disabled(!preferences.transcribeOnMac)
            caption(preferences.transcribeOnMac
                    ? "Lets the dashboard play the meeting back. Without a local transcript the audio is uploaded anyway, so the server can transcribe it."
                    : "Always on while the server transcribes: it needs the audio.")
        }
        Section {
            Picker("Keep recordings on this Mac", selection: Binding(
                get: { model.preferences.keepAudioDays },
                set: { model.setKeepAudioDays($0) }
            )) {
                Text("Delete after upload").tag(0)
                Text("1 day").tag(1)
                Text("7 days").tag(7)
                Text("30 days").tag(30)
            }
            Button("Show recordings in Finder") {
                NSWorkspace.shared.activateFileViewerSelecting([model.folders.recordings])
            }
        }
        Section {
            Picker("Stop after silence", selection: $preferences.silenceStopMinutes) {
                Text("Never").tag(0)
                ForEach(Self.silenceChoices(including: preferences.silenceStopMinutes), id: \.self) { minutes in
                    Text(minutes == 1 ? "1 minute" : "\(minutes) minutes").tag(minutes)
                }
            }
            caption("A meeting left recording after everyone has gone stops by itself when nobody has spoken for this long, and uploads as usual. A minute before, BoringTalks asks if you're still there.")
        }
    }

    @ViewBuilder private var calls: some View {
        @Bindable var preferences = model.preferences
        Section {
            Toggle("Start recording when a call starts", isOn: Binding(
                get: { model.preferences.autoRecordCalls },
                set: { model.setAutoRecordCalls($0) }
            ))
            caption("Zoom, Teams, Webex, Slack, FaceTime, Discord, Skype, WhatsApp and Telegram calls are recorded without asking, a few seconds after the app opens the microphone. A notification says so, with a Stop button. Browsers are only asked about: a web page may use the microphone for anything.")
            Toggle("Offer to record other calls", isOn: $preferences.offerToRecordCalls)
            caption("When a call app or a browser has been using the microphone for a few seconds, BoringTalks asks whether to record. It only sees which app uses the microphone, never what it hears.")
            Toggle("Stop when the call ends", isOn: $preferences.stopWhenCallEnds)
            caption("When the app of the call being recorded stops using the microphone, the recording stops 30 seconds after the others go quiet.")
        }
        if !preferences.ignoredCallApps.isEmpty {
            Section("Never asked") {
                ForEach(preferences.ignoredCallApps, id: \.self) { app in
                    LabeledContent(app) {
                        Button("Ask again") { model.askAgain(about: app) }
                    }
                }
            }
        }
    }

    @ViewBuilder private var account: some View {
        Section {
            switch model.auth {
            case .signedIn(let email):
                LabeledContent("Signed in as", value: email ?? "—")
                LabeledContent("This Mac", value: AppModel.deviceName)
                Button("Sign out", role: .destructive) { model.signOut() }
            default:
                Button("Sign in with browser") { model.signIn() }
            }
        }
        Section {
            LabeledContent("API", value: model.config.apiURL.absoluteString)
            LabeledContent("Dashboard", value: model.config.webURL.absoluteString)
        }
        Section {
            HStack {
                Text("BoringTalks \(Self.version)").foregroundStyle(.secondary)
                Spacer()
                Button("Quit BoringTalks") { NSApp.terminate(nil) }
            }
        }
    }

    private func caption(_ text: String) -> some View {
        Text(text).font(.caption).foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// Room for the title bar and tabs, the menu bar and the Dock. `-settingsMaxHeight 400`
    /// pretends the screen is small.
    static var maxHeight: CGFloat {
        let pretend = UserDefaults.standard.double(forKey: "settingsMaxHeight")
        return max(320, pretend > 0 ? pretend : (NSScreen.main?.visibleFrame.height ?? 800) - 120)
    }

    /// The usual choices, plus a value set with `defaults write` that isn't one of them.
    static func silenceChoices(including current: Int) -> [Int] {
        let choices = [1, 2, 5, 10, 15, 30, 60]
        return current > 0 && !choices.contains(current) ? (choices + [current]).sorted() : choices
    }

    static var version: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }
}
