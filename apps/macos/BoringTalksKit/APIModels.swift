import Foundation

// Swift mirrors of the zod schemas in packages/shared/src (the API contract).
// Field names match the JSON exactly.

/// A stretch of speech by one speaker. Times are milliseconds from the meeting start.
public struct Segment: Codable, Equatable, Sendable {
    public var speaker: String
    public var startMs: Int
    public var endMs: Int
    public var text: String

    public init(speaker: String, startMs: Int, endMs: Int, text: String) {
        self.speaker = speaker
        self.startMs = startMs
        self.endMs = endMs
        self.text = text
    }
}

public enum MeetingStatus: String, Codable, Sendable, CaseIterable {
    case recording, uploaded, transcribing, summarizing, ready, failed

    /// A status this version doesn't know shows as "processing" instead of failing to decode.
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = MeetingStatus(rawValue: raw) ?? .summarizing
    }

    public var title: String {
        switch self {
        case .recording: "Recording"
        case .uploaded: "Uploaded"
        case .transcribing: "Transcribing"
        case .summarizing: "Summarizing"
        case .ready: "Ready"
        case .failed: "Failed"
        }
    }
}

public enum MeetingSource: String, Codable, Sendable {
    case macos, browser, upload, demo, bot
    /// A source this version doesn't know yet, so a newer server never breaks the meeting list.
    case unknown

    public init(from decoder: Decoder) throws {
        self = MeetingSource(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

public struct MeetingListItem: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var title: String
    public var description: String?
    public var status: MeetingStatus
    public var source: MeetingSource?
    public var startedAt: Date
    public var durationSec: Int?
    public var speakers: [String]
    public var actionItemCount: Int
    public var hasAudio: Bool
}

public struct MeetingPage: Codable, Equatable, Sendable {
    public var items: [MeetingListItem]
    public var nextCursor: String?
}

public struct CreateMeetingRequest: Codable, Equatable, Sendable {
    public var title: String?
    public var source: MeetingSource
    public var startedAt: Date?
    public var language: String?

    public init(title: String?, source: MeetingSource = .macos, startedAt: Date?, language: String?) {
        self.title = title
        self.source = source
        self.startedAt = startedAt
        self.language = language
    }
}

/// The part of the created meeting the app needs.
public struct CreatedMeeting: Codable, Equatable, Sendable {
    public var id: String
}

public struct UploadUrlRequest: Codable, Equatable, Sendable {
    public var contentType: String
    public var sizeBytes: Int

    public init(contentType: String = "audio/mp4", sizeBytes: Int) {
        self.contentType = contentType
        self.sizeBytes = sizeBytes
    }
}

public struct UploadUrlResponse: Codable, Equatable, Sendable {
    public var url: URL
    public var key: String
    public var headers: [String: String]
    public var expiresInSec: Int
}

public struct TranscriptUpload: Codable, Equatable, Sendable {
    public var language: String?
    public var durationSec: Int?
    public var segments: [Segment]

    public init(language: String?, durationSec: Int?, segments: [Segment]) {
        self.language = language
        self.durationSec = durationSec
        self.segments = segments
    }
}

public struct CompleteMeetingRequest: Codable, Equatable, Sendable {
    public var durationSec: Int?

    public init(durationSec: Int?) {
        self.durationSec = durationSec
    }
}

public struct DeviceTokenRequest: Codable, Equatable, Sendable {
    public var code: String
    public var codeVerifier: String

    public init(code: String, codeVerifier: String) {
        self.code = code
        self.codeVerifier = codeVerifier
    }
}

public struct DeviceTokenResponse: Codable, Equatable, Sendable {
    public struct User: Codable, Equatable, Sendable {
        public var email: String?
        public var name: String?
    }

    public var token: String
    public var deviceId: String
    public var user: User
}

public struct Me: Codable, Equatable, Sendable {
    public var id: String
    public var email: String?
    public var name: String?
    public var emailOnReady: Bool
    public var createdAt: Date
}

/// Error body of every API response.
public struct APIErrorBody: Codable, Equatable, Sendable {
    public struct Issue: Codable, Equatable, Sendable {
        public var path: String
        public var message: String
    }

    public var statusCode: Int
    public var message: String
    public var issues: [Issue]?
}

/// Contract limits from packages/shared.
public enum APILimits {
    public static let maxSegments = 20_000
    public static let maxSegmentText = 10_000
    public static let maxSpeakerLength = 80
    public static let maxTitleLength = 120
    public static let maxAudioBytes = 200 * 1024 * 1024
}

/// ISO 8601 with milliseconds ("2026-10-06T09:30:00.000Z"), which zod's
/// `datetime()` accepts; decoding also takes timestamps without them.
public enum APICoding {
    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(format(date))
        }
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            guard let date = parse(text) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not an ISO 8601 date: \(text)")
            }
            return date
        }
        return decoder
    }

    public static func format(_ date: Date) -> String {
        formatter(fractional: true).string(from: date)
    }

    public static func parse(_ text: String) -> Date? {
        formatter(fractional: true).date(from: text) ?? formatter(fractional: false).date(from: text)
    }

    /// A new formatter per call: ISO8601DateFormatter isn't Sendable, and this is
    /// nowhere near a hot path.
    private static func formatter(fractional: Bool) -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = fractional ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        return formatter
    }
}
