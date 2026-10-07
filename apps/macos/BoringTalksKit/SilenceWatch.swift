import Foundation

/// Decides when a meeting has gone quiet for long enough that it has probably
/// ended and the recording was left running.
///
/// Times are seconds on the meeting clock (since Start). "Activity" is the last
/// moment anyone was heard; the recorder works it out from the transcript (or the
/// level meters while the speech model is still loading). A minute before the
/// limit it warns, so someone still there can keep the recording going.
public struct SilenceWatch: Equatable, Sendable {
    public enum Verdict: Equatable, Sendable {
        case listening
        /// Quiet for a while; the recording stops in `stopsIn` seconds.
        case warning(stopsIn: TimeInterval)
        case stop
    }

    /// Quiet this long stops the recording; 0 or less turns the watch off.
    public let limit: TimeInterval
    /// How long before the stop the warning starts.
    public let warningLead: TimeInterval
    /// "Keep recording" counts as activity at this moment.
    public private(set) var keptAt: TimeInterval = 0

    public init(limit: TimeInterval, warningLead: TimeInterval = 60) {
        self.limit = limit
        self.warningLead = min(warningLead, limit / 2)
    }

    public var isOn: Bool { limit > 0 }

    /// How long it has been quiet at `now`, given the last activity.
    public func quiet(lastActivity: TimeInterval, now: TimeInterval) -> TimeInterval {
        max(0, now - max(lastActivity, keptAt, 0))
    }

    public func verdict(lastActivity: TimeInterval, now: TimeInterval) -> Verdict {
        guard isOn else { return .listening }
        let quiet = quiet(lastActivity: lastActivity, now: now)
        if quiet >= limit { return .stop }
        if quiet >= limit - warningLead { return .warning(stopsIn: limit - quiet) }
        return .listening
    }

    /// Someone is still there: start counting the quiet again from `now`.
    public mutating func keepRecording(at now: TimeInterval) {
        keptAt = max(keptAt, now)
    }

    /// "5 minutes", "1 minute", "90 seconds": for messages about the limit.
    public static func describe(_ seconds: TimeInterval) -> String {
        let whole = Int(seconds.rounded())
        if whole >= 60, whole % 60 == 0 {
            let minutes = whole / 60
            return minutes == 1 ? "1 minute" : "\(minutes) minutes"
        }
        return whole == 1 ? "1 second" : "\(whole) seconds"
    }
}
