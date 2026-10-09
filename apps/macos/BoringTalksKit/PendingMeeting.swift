import Foundation

/// A finished recording on its way to the server. Persisted, so an upload
/// survives going offline, quitting and relaunching.
public struct PendingMeeting: Codable, Equatable, Identifiable, Sendable {
    /// Where the upload has got to. Each step is safe to repeat.
    public enum Step: String, Codable, Sendable, Comparable {
        /// `POST /meetings` (skipped once `remoteID` is known).
        case create
        /// `POST /meetings/:id/upload-url`, then PUT the file to storage.
        case audio
        /// `PUT /meetings/:id/transcript` (replaces, so repeating is harmless).
        case transcript
        /// `POST /meetings/:id/complete` (409 = already completed = fine).
        case complete
        case done

        private var order: Int {
            switch self {
            case .create: 0
            case .audio: 1
            case .transcript: 2
            case .complete: 3
            case .done: 4
            }
        }

        public static func < (lhs: Step, rhs: Step) -> Bool { lhs.order < rhs.order }
    }

    /// Local id; also the idempotency key of `POST /meetings` and the audio file name.
    public var id: UUID
    public var title: String?
    public var startedAt: Date
    public var durationSec: Int
    public var language: String?
    public var segments: [Segment]
    /// File name in the Recordings folder, if audio was recorded.
    public var audioFileName: String?
    /// The user's "Upload audio" setting at the time of recording.
    public var uploadAudio: Bool
    /// `.micSystem` when the meeting was recorded for the server to transcribe, each side on its
    /// own channel; nil (older uploads) is a mono mix.
    public var audioChannels: AudioChannels?
    public var remoteID: String?
    public var step: Step
    /// Failed for good (the server refused it); waits for the user to retry or discard.
    public var isFailed: Bool
    /// Failed attempts in a row at the current step.
    public var attempts: Int
    public var nextAttemptAt: Date?
    public var lastError: String?

    public init(id: UUID = UUID(), title: String?, startedAt: Date, durationSec: Int, language: String?,
                segments: [Segment], audioFileName: String?, uploadAudio: Bool, audioChannels: AudioChannels? = nil) {
        self.id = id
        self.title = title
        self.startedAt = startedAt
        self.durationSec = durationSec
        self.language = language
        self.segments = segments
        self.audioFileName = audioFileName
        self.uploadAudio = uploadAudio
        self.audioChannels = audioChannels
        self.remoteID = nil
        self.step = .create
        self.isFailed = false
        self.attempts = 0
        self.nextAttemptAt = nil
        self.lastError = nil
    }

    /// Audio goes up when the user wants it kept, and always when there is no
    /// transcript: then the server transcribes it instead.
    public func sendsAudio(fileExists: Bool) -> Bool {
        audioFileName != nil && fileExists && (uploadAudio || segments.isEmpty)
    }

    /// The step after `step`, skipping the ones with nothing to do.
    public func step(after step: Step, audioExists: Bool) -> Step {
        var next = step
        while next != .done {
            switch next {
            case .create: next = .audio
            case .audio: next = .transcript
            case .transcript: next = .complete
            case .complete, .done: next = .done
            }
            if next == .audio, !sendsAudio(fileExists: audioExists) { continue }
            if next == .transcript, segments.isEmpty { continue }
            return next
        }
        return .done
    }

    /// Something to upload at all: a transcript, or audio for the server to transcribe.
    public func hasContent(audioExists: Bool) -> Bool {
        !segments.isEmpty || sendsAudio(fileExists: audioExists)
    }
}

/// Where the queue is kept between launches.
public protocol UploadStore: Sendable {
    func load() throws -> [PendingMeeting]
    func save(_ items: [PendingMeeting]) throws
}

/// A JSON file in Application Support, written atomically.
public struct FileUploadStore: UploadStore {
    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    public func load() throws -> [PendingMeeting] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        return try APICoding.decoder().decode([PendingMeeting].self, from: Data(contentsOf: url))
    }

    public func save(_ items: [PendingMeeting]) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try APICoding.encoder().encode(items).write(to: url, options: .atomic)
    }
}

public final class InMemoryUploadStore: UploadStore, @unchecked Sendable {
    private var items: [PendingMeeting]
    private let lock = NSLock()
    public private(set) var saves = 0

    public init(_ items: [PendingMeeting] = []) {
        self.items = items
    }

    public func load() throws -> [PendingMeeting] {
        lock.withLock { items }
    }

    public func save(_ items: [PendingMeeting]) throws {
        lock.withLock {
            self.items = items
            saves += 1
        }
    }
}

/// Wait before retrying: 5 s, 10 s, 20 s… up to 15 minutes.
public struct Backoff: Equatable, Sendable {
    public var base: TimeInterval
    public var maximum: TimeInterval

    public init(base: TimeInterval = 5, maximum: TimeInterval = 15 * 60) {
        self.base = base
        self.maximum = maximum
    }

    public func delay(afterAttempts attempts: Int) -> TimeInterval {
        guard attempts > 0 else { return 0 }
        let exponent = Double(min(attempts - 1, 30))
        return min(base * pow(2, exponent), maximum)
    }
}
