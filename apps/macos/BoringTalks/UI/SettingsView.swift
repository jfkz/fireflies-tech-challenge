import BoringTalksKit
import SwiftUI

struct SettingsView: View {
    @Bindable var model: AppModel

    var body: some View {
        @Bindable var preferences = model.preferences
        Form {
            Section("Speech model") {
                LabeledContent("Status", value: model.models.summary)
                ModelProgress(models: model.models)
                if case .failed = model.models.state {
                    Button("Try downloading again") {
                        Task { await model.models.prepare() }
                    }
                }
                Picker("Language", selection: $preferences.language) {
                    Text("Detect automatically").tag("")
                    Divider()
                    ForEach(ParakeetEngine.languages, id: \.code) { language in
                        Text(language.name).tag(language.code)
                    }
                }
                Text("Transcription runs on this Mac (Parakeet v3 on the Neural Engine, 25 European languages). Nothing is sent to a speech service.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Audio") {
                Toggle("Keep Bluetooth headsets in high quality", isOn: $preferences.avoidBluetoothMic)
                Text("Recording with a Bluetooth headset's microphone switches the headset to call quality. With this on, “You” is recorded with the Mac's own microphone instead.")
                    .font(.caption).foregroundStyle(.secondary)
                Toggle("Upload meeting audio", isOn: $preferences.uploadAudio)
                Text("Lets the dashboard play the meeting back. Without a local transcript the audio is uploaded anyway, so the server can transcribe it.")
                    .font(.caption).foregroundStyle(.secondary)
                Picker("Keep recordings on this Mac", selection: Binding(
                    get: { model.preferences.keepAudioDays },
                    set: { model.setKeepAudioDays($0) }
                )) {
                    Text("Delete after upload").tag(0)
                    Text("1 day").tag(1)
                    Text("7 days").tag(7)
                    Text("30 days").tag(30)
                }
                Picker("Stop after silence", selection: $preferences.silenceStopMinutes) {
                    Text("Never").tag(0)
                    ForEach(Self.silenceChoices(including: preferences.silenceStopMinutes), id: \.self) { minutes in
                        Text(minutes == 1 ? "1 minute" : "\(minutes) minutes").tag(minutes)
                    }
                }
                Text("A meeting left recording after everyone has gone stops by itself when nobody has spoken for this long, and uploads as usual. A minute before, BoringTalks asks if you're still there.")
                    .font(.caption).foregroundStyle(.secondary)
                Button("Show recordings in Finder") {
                    NSWorkspace.shared.activateFileViewerSelecting([model.folders.recordings])
                }
            }

            Section("Calls") {
                Toggle("Offer to record when a call starts", isOn: $preferences.offerToRecordCalls)
                Text("When Zoom, Teams, Webex, Slack, FaceTime or a browser has been using the microphone for a few seconds, BoringTalks asks whether to record. It only sees which app uses the microphone, never what it hears, and never records without asking.")
                    .font(.caption).foregroundStyle(.secondary)
                Toggle("Stop when the call ends", isOn: $preferences.stopWhenCallEnds)
                Text("When the app of the call being recorded stops using the microphone, the recording stops 30 seconds after the others go quiet.")
                    .font(.caption).foregroundStyle(.secondary)
                ForEach(preferences.ignoredCallApps, id: \.self) { app in
                    LabeledContent("Never asked for \(app)") {
                        Button("Ask again") { model.askAgain(about: app) }
                    }
                }
            }

            Section("Account") {
                switch model.auth {
                case .signedIn(let email):
                    LabeledContent("Signed in as", value: email ?? "—")
                    LabeledContent("This Mac", value: AppModel.deviceName)
                    Button("Sign out", role: .destructive) { model.signOut() }
                default:
                    Button("Sign in with browser") { model.signIn() }
                }
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
        .formStyle(.grouped)
        .frame(width: 480)
        .fixedSize(horizontal: false, vertical: true)
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
