import Foundation

/// The longest recording the account allows (from the API's GET /me, set by an admin): a warning
/// in the last 5 minutes (half the limit when that is shorter), then stop. Times are seconds on the
/// meeting clock. Unlike the silence stop, nothing keeps it going.
public struct RecordingLimit: Equatable, Sendable {
    /// A meeting stops at this many seconds; 0 or less means no limit.
    public let seconds: TimeInterval
    public let warningLead: TimeInterval

    public init(seconds: TimeInterval, warningLead: TimeInterval = 300) {
        self.seconds = seconds
        self.warningLead = min(warningLead, seconds / 2)
    }

    public var isOn: Bool { seconds > 0 }

    public func verdict(elapsed: TimeInterval) -> SilenceWatch.Verdict {
        guard isOn else { return .listening }
        let left = seconds - elapsed
        if left <= 0 { return .stop }
        return left <= warningLead ? .warning(stopsIn: left) : .listening
    }

    /// "2 hours", "90 minutes", "1 hour": for messages about the limit.
    public static func describe(_ seconds: TimeInterval) -> String {
        let minutes = Int((seconds / 60).rounded())
        if minutes >= 60, minutes % 60 == 0 { return minutes == 60 ? "1 hour" : "\(minutes / 60) hours" }
        return minutes == 1 ? "1 minute" : "\(minutes) minutes"
    }
}
