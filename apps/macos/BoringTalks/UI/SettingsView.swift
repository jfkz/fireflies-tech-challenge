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
                Button("Show recordings in Finder") {
                    NSWorkspace.shared.activateFileViewerSelecting([model.folders.recordings])
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

    static var version: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }
}
