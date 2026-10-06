import BoringTalksKit
import SwiftUI

/// The menu-bar window.
struct MenuContent: View {
    @Bindable var model: AppModel
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            Divider()
            switch model.auth {
            case .signedIn:
                RecordingPanel(model: model, recorder: model.recorder)
                Divider()
                UploadStatus(model: model)
                RecentMeetings(model: model)
            case .unknown:
                ProgressView().frame(maxWidth: .infinity)
            case .signedOut, .waitingForBrowser:
                SignInPanel(model: model)
            }
            Divider()
            footer
        }
        .padding(14)
        .frame(width: 340)
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "bubble.left.and.text.bubble.right.fill")
                .font(.title2)
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 1) {
                Text("BoringTalks").font(.headline)
                if case .signedIn(let email) = model.auth {
                    Text(email ?? "Signed in").font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("Meetings, written down for you").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if !model.config.isProduction {
                Text(model.config.apiURL.host() ?? "dev")
                    .font(.caption2.monospaced())
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(.yellow.opacity(0.3), in: Capsule())
            }
        }
    }

    private var footer: some View {
        HStack {
            Button("Dashboard") { model.openDashboard() }
            Button("Settings…") {
                NSApp.activate()
                openSettings()
            }
            Spacer()
            Button("Quit") { NSApp.terminate(nil) }
                .keyboardShortcut("q")
        }
        .buttonStyle(.borderless)
        .font(.callout)
    }
}

private struct SignInPanel: View {
    @Bindable var model: AppModel
    @State private var pasted = ""
    @State private var showPaste = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Sign in to send your meetings to the dashboard. Transcription happens on this Mac.")
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                model.signIn()
            } label: {
                Label("Sign in with browser", systemImage: "safari")
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.large)
            .buttonStyle(.borderedProminent)
            Button("Signed in to another browser? Copy the sign-in link") { model.copySignInLink() }
                .buttonStyle(.link)
                .font(.caption)
            if model.auth == .waitingForBrowser {
                HStack {
                    ProgressView().controlSize(.small)
                    Text(model.linkCopied ? "Link copied. Open it in the browser you use for BoringTalks…" : "Finish signing in in your browser…")
                        .font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Button("Cancel") { model.cancelSignIn() }.buttonStyle(.borderless).font(.caption)
                }
            }
            DisclosureGroup("Paste code", isExpanded: $showPaste) {
                HStack {
                    TextField("Code or boringtalks:// link", text: $pasted)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit(submit)
                    Button("Connect", action: submit)
                        .disabled(pasted.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(.top, 4)
            }
            .font(.callout)
            if let error = model.authError {
                Text(error).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func submit() {
        model.submitPasted(pasted)
        pasted = ""
    }
}

private struct RecordingPanel: View {
    @Bindable var model: AppModel
    let recorder: MeetingRecorder

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Meeting title (optional)", text: $model.titleDraft)
                .textFieldStyle(.roundedBorder)
                .disabled(recorder.phase != .idle)

            Button(action: toggle) {
                HStack {
                    Image(systemName: recorder.isRecording ? "stop.fill" : "record.circle")
                    Text(buttonTitle)
                    Spacer()
                    if let startedAt = recorder.startedAt, recorder.isRecording {
                        ElapsedText(since: startedAt).monospacedDigit()
                    }
                }
                .font(.title3.weight(.semibold))
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(recorder.isRecording ? .red : .accentColor)
            .controlSize(.large)
            .disabled(recorder.phase == .starting || recorder.phase == .finishing)

            VStack(spacing: 6) {
                LevelRow(title: "You", systemImage: "mic.fill", meter: recorder.meter(.microphone), active: recorder.isRecording)
                LevelRow(title: "Others", systemImage: "speaker.wave.2.fill", meter: recorder.meter(.system), active: recorder.isRecording)
            }

            ForEach(recorder.warnings.sorted(by: { $0.key.rawValue < $1.key.rawValue }), id: \.key) { _, warning in
                Label(warning, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption).foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let error = model.recordError {
                Text(error).font(.caption).foregroundStyle(.red)
            }
            if recorder.isRecording, recorder.waitingForModel {
                Label("Recording. The speech model is still loading — the transcript catches up once it's ready.",
                      systemImage: "hourglass")
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if case .loading = model.models.state {
                ModelProgress(models: model.models)
            }

            Button {
                model.toggleLiveWindow()
            } label: {
                Label(model.liveWindowVisible ? "Hide live transcript" : "Show live transcript", systemImage: "text.bubble")
            }
            .buttonStyle(.borderless)
        }
    }

    private var buttonTitle: String {
        switch recorder.phase {
        case .idle: "Start meeting"
        case .starting: "Starting…"
        case .recording: "Stop"
        case .finishing: "Finishing transcript…"
        }
    }

    private func toggle() {
        // Run after SwiftUI has finished delivering the click: starting or stopping
        // swaps this part of the menu (and can close the menu window), which must not
        // happen while the button's gesture is still being dispatched.
        let recording = recorder.isRecording
        DispatchQueue.main.async { [model] in
            recording ? model.stopMeeting() : model.startMeeting()
        }
    }
}

struct ModelProgress: View {
    let models: SpeechModels

    var body: some View {
        if case .loading(let title, let fraction) = models.state {
            VStack(alignment: .leading, spacing: 4) {
                if let fraction {
                    ProgressView(value: fraction)
                } else {
                    ProgressView().progressViewStyle(.linear)
                }
                Text(fraction.map { "\(title)… \(Int($0 * 100))%" } ?? "\(title)…")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

private struct ElapsedText: View {
    let since: Date

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let seconds = max(0, Int(context.date.timeIntervalSince(since)))
            Text(seconds >= 3600
                 ? String(format: "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
                 : String(format: "%d:%02d", seconds / 60, seconds % 60))
        }
    }
}

private struct LevelRow: View {
    let title: String
    let systemImage: String
    let meter: LevelMeter
    let active: Bool

    var body: some View {
        HStack(spacing: 8) {
            Label(title, systemImage: systemImage)
                .font(.caption)
                .frame(width: 70, alignment: .leading)
            TimelineView(.animation(minimumInterval: 1 / 15, paused: !active)) { _ in
                let level = active ? CGFloat(meter.snapshot().level) : 0
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.quaternary)
                        Capsule()
                            .fill(LinearGradient(colors: [.green, .yellow, .orange], startPoint: .leading, endPoint: .trailing))
                            .frame(width: max(4, geometry.size.width * level))
                            .opacity(active ? 1 : 0.2)
                    }
                }
                .frame(height: 6)
            }
        }
    }
}

private struct UploadStatus: View {
    let model: AppModel

    var body: some View {
        let uploads = model.uploads
        if !uploads.items.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Image(systemName: uploads.isOnline ? "arrow.up.circle" : "wifi.slash")
                    Text(summary(uploads)).font(.callout)
                    Spacer()
                    if uploads.failed > 0 || !uploads.isOnline || uploads.items.contains(where: { $0.nextAttemptAt != nil }) {
                        Button("Retry") { model.retryUploads() }.buttonStyle(.borderless).font(.caption)
                    }
                }
                ForEach(uploads.items.filter(\.isFailed)) { item in
                    HStack {
                        Text("\(item.title ?? "Meeting") — \(item.lastError ?? "failed")")
                            .font(.caption).foregroundStyle(.red).lineLimit(2)
                        Spacer()
                        Button("Discard") { model.discardUpload(item.id) }.buttonStyle(.borderless).font(.caption)
                    }
                }
            }
            Divider()
        }
    }

    private func summary(_ uploads: UploadQueue.Snapshot) -> String {
        let count = uploads.waiting
        let noun = count == 1 ? "upload" : "uploads"
        if uploads.needsSignIn { return "\(count) \(noun) waiting — sign in again" }
        if !uploads.isOnline { return "\(count) \(noun) waiting — offline" }
        if uploads.activeID != nil { return "Uploading… (\(count) waiting)" }
        if uploads.failed > 0, count == 0 { return "\(uploads.failed) upload\(uploads.failed == 1 ? "" : "s") failed" }
        return "\(count) \(noun) waiting — will retry"
    }
}

private struct RecentMeetings: View {
    let model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Recent meetings").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                Button {
                    model.refreshMeetings()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .help("Refresh")
            }
            if let error = model.meetingsError {
                Text(error).font(.caption).foregroundStyle(.red).lineLimit(2)
            } else if model.recentMeetings.isEmpty {
                Text("No meetings yet. Press Start when your next call begins.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            ForEach(model.recentMeetings) { meeting in
                Button {
                    model.open(meeting: meeting)
                } label: {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(meeting.title).lineLimit(1)
                            Text(meeting.startedAt.formatted(date: .abbreviated, time: .shortened))
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        Spacer()
                        StatusChip(status: meeting.status)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct StatusChip: View {
    let status: MeetingStatus

    var body: some View {
        Text(status.title)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.18), in: Capsule())
            .foregroundStyle(color)
    }

    private var color: Color {
        switch status {
        case .ready: .green
        case .failed: .red
        case .recording: .orange
        default: .blue
        }
    }
}
