import BoringTalksKit
import Foundation
import Observation

/// What the live transcript window shows: finished phrases with speaker labels,
/// plus the phrase each side is saying right now.
@MainActor @Observable
final class LiveTranscript {
    struct Line: Identifiable, Equatable {
        let id: UUID
        var speaker: String
        var channel: AudioChannel
        var text: String
        var isFinal: Bool
        /// Milliseconds from the meeting start.
        var startMs: Int
    }

    private(set) var lines: [Line] = []
    private(set) var previews: [AudioChannel: Line] = [:]
    /// When each side last got words; drives the talking heads.
    @ObservationIgnored let clocks: [AudioChannel: SpeechClock] = [.microphone: SpeechClock(), .system: SpeechClock()]
    @ObservationIgnored private var labeler = SpeakerLabeler()
    /// The last speaker heard on system audio, for words whose voice isn't known yet.
    @ObservationIgnored private var lastSystemSpeaker: String?
    private static let keep = 300

    func reset() {
        lines = []
        previews = [:]
        labeler = SpeakerLabeler()
        lastSystemSpeaker = nil
    }

    func receive(text: String, isFinal: Bool, channel: AudioChannel, voice: Int?, startMs: Int) {
        let label = labeler.label(channel: channel, voice: voice)
            ?? lastSystemSpeaker ?? (channel == .system ? SpeakerLabeler.others : SpeakerLabeler.you)
        if channel == .system, voice != nil { lastSystemSpeaker = label }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if isFinal {
            previews[channel] = nil
            guard !trimmed.isEmpty else { return }
            lines.append(Line(id: UUID(), speaker: label, channel: channel, text: trimmed, isFinal: true, startMs: startMs))
            if lines.count > Self.keep { lines.removeFirst(lines.count - Self.keep) }
        } else {
            guard !trimmed.isEmpty else { return }
            previews[channel] = Line(id: previews[channel]?.id ?? UUID(), speaker: label, channel: channel,
                                     text: trimmed, isFinal: false, startMs: startMs)
        }
        clocks[channel]?.mark()
    }

    /// Sample lines for `--demo` and screenshots.
    func showDemo() {
        reset()
        let script: [(AudioChannel, Int?, String)] = [
            (.system, 1, "Okay, let's start. Can everyone see my screen?"),
            (.microphone, nil, "Yes, we can see it. Go ahead."),
            (.system, 2, "Quick update on pricing: we're moving Pro to twenty-nine dollars."),
            (.system, 1, "When does that go live?"),
            (.system, 2, "November third, if legal signs off this week."),
            (.microphone, nil, "I'll ping legal today and send the draft to everyone."),
        ]
        for (index, (channel, voice, text)) in script.enumerated() {
            receive(text: text, isFinal: true, channel: channel, voice: voice, startMs: index * 4200)
        }
        receive(text: "Great, so the next step is the", isFinal: false, channel: .system, voice: 1, startMs: 27000)
    }
}
