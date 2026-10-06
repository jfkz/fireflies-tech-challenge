import AppKit
import BoringTalksKit
import SwiftUI

/// A small floating window: two cartoon heads (you and the others) that talk while
/// their words arrive, and the transcript as it is written.
struct LiveTranscriptView: View {
    let recorder: MeetingRecorder
    var live: LiveTranscript { recorder.live }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .bottom, spacing: 18) {
                head(.system, style: .listener, title: "Others", look: 1)
                head(.microphone, style: .talker, title: "You", look: -1)
            }
            .padding(.top, 12)
            .padding(.bottom, 8)
            .frame(maxWidth: .infinity)
            .background(LinearGradient(colors: [Color.orange.opacity(0.18), .clear], startPoint: .top, endPoint: .bottom))

            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        if live.lines.isEmpty, live.previews.isEmpty {
                            Text(recorder.isRecording ? "Listening…" : "Start a meeting from the menu bar to see the transcript here.")
                                .font(.callout).foregroundStyle(.secondary)
                                .padding(.top, 20)
                        }
                        ForEach(live.lines) { line in
                            LineView(line: line)
                        }
                        ForEach(AudioChannel.allCases, id: \.self) { channel in
                            if let preview = live.previews[channel] {
                                LineView(line: preview)
                            }
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(12)
                }
                .onChange(of: live.lines.count) { proxy.scrollTo("bottom") }
                .onChange(of: live.previews.values.map(\.text)) { proxy.scrollTo("bottom") }
            }
        }
        .frame(minWidth: 320, minHeight: 360)
    }

    private func head(_ channel: AudioChannel, style: AvatarStyle, title: String, look: CGFloat) -> some View {
        VStack(spacing: 2) {
            AvatarView(style: style, meter: recorder.meter(channel), clock: live.clocks[channel] ?? SpeechClock(), look: look)
                .frame(width: 92, height: 92)
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
        }
    }
}

private struct LineView: View {
    let line: LiveTranscript.Line

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(line.speaker).font(.caption.weight(.bold)).foregroundStyle(color)
                Text(timestamp).font(.caption2.monospacedDigit()).foregroundStyle(.tertiary)
            }
            Text(line.text)
                .font(.body)
                .foregroundStyle(line.isFinal ? .primary : .secondary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var timestamp: String {
        let seconds = line.startMs / 1000
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    private var color: Color {
        guard line.channel == .system else { return .orange }
        let palette: [Color] = [.blue, .purple, .teal, .pink, .green, .indigo]
        let number = Int(line.speaker.split(separator: " ").last ?? "") ?? 0
        return palette[number % palette.count]
    }
}

/// Shows the live transcript in a floating panel that stays above the meeting app.
@MainActor
final class LiveWindowController: NSObject, NSWindowDelegate {
    private var panel: NSPanel?
    private let model: AppModel

    init(model: AppModel) {
        self.model = model
    }

    func setVisible(_ visible: Bool) {
        visible ? show() : panel?.orderOut(nil)
    }

    private func show() {
        if panel == nil {
            let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 360, height: 460),
                                styleMask: [.titled, .closable, .resizable, .utilityWindow, .nonactivatingPanel],
                                backing: .buffered, defer: false)
            panel.title = "Live transcript"
            panel.level = .floating
            panel.isFloatingPanel = true
            panel.hidesOnDeactivate = false
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            panel.isReleasedWhenClosed = false
            panel.delegate = self
            panel.contentView = NSHostingView(rootView: LiveTranscriptView(recorder: model.recorder))
            panel.setFrameAutosaveName("LiveTranscript")
            if !panel.setFrameUsingName("LiveTranscript"), let screen = NSScreen.main {
                let frame = screen.visibleFrame
                panel.setFrameOrigin(NSPoint(x: frame.maxX - 380, y: frame.maxY - 480))
            }
            self.panel = panel
        }
        panel?.orderFrontRegardless()
    }

    func windowWillClose(_ notification: Notification) {
        if model.liveWindowVisible { model.liveWindowVisible = false }
    }
}
