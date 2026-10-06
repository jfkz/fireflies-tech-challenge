import Foundation

/// The two sides of a meeting.
public enum AudioChannel: String, Codable, Sendable, CaseIterable {
    /// The microphone: the user.
    case microphone
    /// What the Mac plays: everyone else on the call.
    case system
}

/// One finished phrase as a transcriber produced it, before speaker labels.
public struct PhraseRecord: Equatable, Sendable {
    public var channel: AudioChannel
    /// The voice the registry recognized (system audio only); nil when unknown.
    public var voice: Int?
    /// Milliseconds from the meeting start.
    public var startMs: Int
    public var endMs: Int
    public var text: String

    public init(channel: AudioChannel, voice: Int?, startMs: Int, endMs: Int, text: String) {
        self.channel = channel
        self.voice = voice
        self.startMs = startMs
        self.endMs = endMs
        self.text = text
    }
}

/// Names speakers the way the transcript shows them: the microphone is "You",
/// voices on system audio are "Speaker 1…N" in the order they first spoke.
public struct SpeakerLabeler: Sendable {
    public static let you = "You"
    /// System audio when voices couldn't be told apart at all.
    public static let others = "Others"

    private var numbers: [Int: Int] = [:]

    public init() {}

    public mutating func label(channel: AudioChannel, voice: Int?) -> String? {
        switch channel {
        case .microphone:
            return Self.you
        case .system:
            guard let voice else { return nil }
            if let number = numbers[voice] { return "Speaker \(number)" }
            let number = numbers.count + 1
            numbers[voice] = number
            return "Speaker \(number)"
        }
    }
}

/// Turns the phrases of both channels into the segments the API takes.
public enum SegmentAssembler {
    /// - Orders phrases by time and gives them speaker labels.
    /// - A system phrase without a recognized voice (a laugh, a word or two) goes to
    ///   the system speaker just before it, else just after, else "Others".
    /// - Without headphones the microphone also hears the call: a microphone phrase
    ///   that overlaps a system phrase and repeats most of its words is that echo,
    ///   and is dropped.
    /// - Empty text is dropped, text and speaker names are clipped to the API limits.
    public static func assemble(_ phrases: [PhraseRecord], dropEcho: Bool = true) -> [Segment] {
        var cleaned = phrases.compactMap { phrase -> PhraseRecord? in
            var phrase = phrase
            phrase.text = phrase.text.trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            guard !phrase.text.isEmpty else { return nil }
            phrase.startMs = max(0, phrase.startMs)
            phrase.endMs = max(phrase.startMs, phrase.endMs)
            phrase.text = String(phrase.text.prefix(APILimits.maxSegmentText))
            return phrase
        }
        cleaned.sort { ($0.startMs, $0.endMs, $0.channel == .system ? 0 : 1) < ($1.startMs, $1.endMs, $1.channel == .system ? 0 : 1) }

        if dropEcho {
            let system = cleaned.filter { $0.channel == .system }
            cleaned.removeAll { $0.channel == .microphone && isEcho($0, of: system) }
        }

        var labeler = SpeakerLabeler()
        var labels: [String?] = cleaned.map { labeler.label(channel: $0.channel, voice: $0.voice) }
        // Unknown system voices borrow the nearest earlier (or later) system speaker.
        for index in labels.indices where labels[index] == nil {
            let before = labels[..<index].indices.reversed().first { cleaned[$0].channel == .system && labels[$0] != nil }
            let after = labels[(index + 1)...].indices.first { cleaned[$0].channel == .system && labels[$0] != nil }
            labels[index] = before.flatMap { labels[$0] } ?? after.flatMap { labels[$0] } ?? SpeakerLabeler.others
        }

        return zip(cleaned, labels).prefix(APILimits.maxSegments).map { phrase, label in
            Segment(speaker: String((label ?? SpeakerLabeler.others).prefix(APILimits.maxSpeakerLength)),
                    startMs: phrase.startMs, endMs: phrase.endMs, text: phrase.text)
        }
    }

    /// The microphone heard the speakers: same time (give or take the 1.5 s the
    /// two transcribers may cut phrases differently) and mostly the same words.
    static func isEcho(_ mic: PhraseRecord, of system: [PhraseRecord]) -> Bool {
        let micWords = words(mic.text)
        guard !micWords.isEmpty else { return false }
        let slack = 1500
        let nearby = system.filter { $0.startMs <= mic.endMs + slack && $0.endMs >= mic.startMs - slack }
        guard !nearby.isEmpty else { return false }
        let heard = Set(nearby.flatMap { words($0.text) })
        let repeated = micWords.filter(heard.contains).count
        return Double(repeated) / Double(micWords.count) >= 0.6
    }

    static func words(_ text: String) -> [String] {
        text.lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
    }
}
