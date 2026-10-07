import Foundation

/// An app that holds calls, recognized by the bundle ID of a process using the microphone.
public struct CallApp: Hashable, Sendable {
    /// What the user calls it ("Zoom", "Chrome"); several processes map to one name.
    public let name: String
    /// Browsers also open the microphone for voice notes and dictation, so they wait longer.
    public let isBrowser: Bool

    public init(name: String, isBrowser: Bool) {
        self.name = name
        self.isBrowser = isBrowser
    }
}

public enum CallApps {
    /// Bundle ID prefixes (helpers included: Chrome records in `com.google.Chrome.helper`,
    /// Safari in `com.apple.WebKit.GPU`, FaceTime and iPhone calls in `avconferenced`).
    static let known: [(prefix: String, app: CallApp)] = [
        ("us.zoom.", CallApp(name: "Zoom", isBrowser: false)),
        ("com.microsoft.teams", CallApp(name: "Teams", isBrowser: false)),
        ("Cisco-Systems.Spark", CallApp(name: "Webex", isBrowser: false)),
        ("com.webex.", CallApp(name: "Webex", isBrowser: false)),
        ("com.tinyspeck.slackmacgap", CallApp(name: "Slack", isBrowser: false)),
        ("com.apple.FaceTime", CallApp(name: "FaceTime", isBrowser: false)),
        ("com.apple.avconferenced", CallApp(name: "FaceTime", isBrowser: false)),
        ("com.hnc.Discord", CallApp(name: "Discord", isBrowser: false)),
        ("com.skype.", CallApp(name: "Skype", isBrowser: false)),
        ("net.whatsapp.WhatsApp", CallApp(name: "WhatsApp", isBrowser: false)),
        ("ru.keepcoder.Telegram", CallApp(name: "Telegram", isBrowser: false)),
        ("org.telegram.desktop", CallApp(name: "Telegram", isBrowser: false)),
        ("com.google.Chrome", CallApp(name: "Chrome", isBrowser: true)),
        ("com.brave.Browser", CallApp(name: "Brave", isBrowser: true)),
        ("company.thebrowser.Browser", CallApp(name: "Arc", isBrowser: true)),
        ("com.microsoft.edgemac", CallApp(name: "Edge", isBrowser: true)),
        ("org.mozilla.firefox", CallApp(name: "Firefox", isBrowser: true)),
        ("org.mozilla.plugincontainer", CallApp(name: "Firefox", isBrowser: true)),
        ("com.apple.Safari", CallApp(name: "Safari", isBrowser: true)),
        ("com.apple.WebKit.GPU", CallApp(name: "Safari", isBrowser: true)),
        ("com.operasoftware.Opera", CallApp(name: "Opera", isBrowser: true)),
        ("com.vivaldi.Vivaldi", CallApp(name: "Vivaldi", isBrowser: true)),
    ]

    /// The call app behind a microphone user, or nil for anything else (dictation, Siri,
    /// a voice recorder…). `extra` are bundle IDs added by hand (`defaults write … extraCallApps`).
    public static func identify(_ bundleID: String, extra: [String] = []) -> CallApp? {
        if let match = known.first(where: { bundleID.hasPrefix($0.prefix) }) { return match.app }
        if let added = extra.first(where: { !$0.isEmpty && bundleID.hasPrefix($0) }) {
            return CallApp(name: added.split(separator: ".").last.map(String.init) ?? added, isBrowser: false)
        }
        return nil
    }
}

/// Turns "which call apps have the microphone open" into what the app should do:
/// offer to record a call that has started, and notice when the recorded call ends.
///
/// Fed every couple of seconds with the apps using the mic. Times are seconds on any
/// monotonic clock.
public struct CallSignals: Sendable {
    public enum Event: Equatable, Sendable {
        /// `app` has held the microphone long enough to be a call: ask to record it.
        case offer(app: String)
        /// The app offered for released the microphone before anyone answered.
        case withdraw(app: String)
        /// The app of the call being recorded released the microphone.
        case callEnded(app: String)
        /// …and took it back (a device switch, a reconnect).
        case callResumed(app: String)
    }

    /// How long an app must hold the mic before it counts as a call.
    public var appDelay: TimeInterval
    public var browserDelay: TimeInterval
    public var offersEnabled = true
    /// App names the user said never to ask about.
    public var ignored: Set<String> = []

    /// The offer waiting for an answer.
    public private(set) var pendingOffer: String?
    /// The app whose call is being recorded.
    public private(set) var callApp: String?

    private var since: [String: TimeInterval] = [:]
    private var apps: [String: CallApp] = [:]
    /// Asked about during this call (until the app releases the mic).
    private var asked: Set<String> = []
    private var callAppGone = false

    public init(appDelay: TimeInterval = 5, browserDelay: TimeInterval = 15) {
        self.appDelay = appDelay
        self.browserDelay = browserDelay
    }

    public mutating func update(active: [CallApp], now: TimeInterval, isRecording: Bool) -> [Event] {
        var events: [Event] = []
        let current = Dictionary(active.map { ($0.name, $0) }, uniquingKeysWith: { first, _ in first })

        for name in since.keys.sorted() where current[name] == nil {
            since[name] = nil
            apps[name] = nil
            asked.remove(name)
            if pendingOffer == name {
                pendingOffer = nil
                events.append(.withdraw(app: name))
            }
            if callApp == name, !callAppGone {
                callAppGone = true
                events.append(.callEnded(app: name))
            }
        }
        for (name, app) in current.sorted(by: { $0.key < $1.key }) where since[name] == nil {
            since[name] = now
            apps[name] = app
            if callApp == name, callAppGone {
                callAppGone = false
                events.append(.callResumed(app: name))
            }
        }

        let settled = settledApps(at: now)
        if isRecording {
            if callApp == nil { callApp = settled.first }
        } else if offersEnabled, pendingOffer == nil,
                  let app = settled.first(where: { !asked.contains($0) && !ignored.contains($0) }) {
            // One question per call, even when a browser holds the mic alongside the call app.
            asked.formUnion(settled)
            pendingOffer = app
            events.append(.offer(app: app))
        }
        return events
    }

    /// Recording began (from the offer or by hand): it belongs to the call holding the mic.
    public mutating func recordingStarted(now: TimeInterval) {
        pendingOffer = nil
        callApp = settledApps(at: now).first
        callAppGone = false
    }

    /// Stopped by hand or by itself: a call still holding the mic isn't offered again.
    public mutating func recordingStopped() {
        callApp = nil
        callAppGone = false
        asked.formUnion(since.keys)
    }

    /// "Not now": don't ask again until that app releases the mic.
    public mutating func declineOffer() {
        pendingOffer = nil
    }

    /// Apps holding the mic for at least their delay: call apps before browsers, then longest first.
    private func settledApps(at now: TimeInterval) -> [String] {
        func isBrowser(_ name: String) -> Bool { apps[name]?.isBrowser == true }
        return since.filter { name, start in now - start >= (isBrowser(name) ? browserDelay : appDelay) }
            .sorted { a, b in
                if isBrowser(a.key) != isBrowser(b.key) { return !isBrowser(a.key) }
                return a.value == b.value ? a.key < b.key : a.value < b.value
            }
            .map(\.key)
    }
}

/// After the recorded call's app hangs up, stops the meeting once the other side has
/// been quiet for `grace` seconds: long enough to ride out a reconnect, short enough
/// not to leave a finished call recording. "Keep recording" or the app taking the mic
/// back cancels it.
public struct CallEndWatch: Equatable, Sendable {
    public enum Verdict: Equatable, Sendable {
        case recording
        case stopping(stopsIn: TimeInterval)
        case stop
    }

    public let grace: TimeInterval
    public private(set) var endedAt: TimeInterval?

    public init(grace: TimeInterval = 30) {
        self.grace = grace
    }

    public mutating func callEnded(at now: TimeInterval) {
        if endedAt == nil { endedAt = now }
    }

    public mutating func cancel() {
        endedAt = nil
    }

    /// `lastOthers`: when someone on the other side was last heard.
    public func verdict(lastOthers: TimeInterval, now: TimeInterval) -> Verdict {
        guard let endedAt else { return .recording }
        let quiet = now - max(endedAt, lastOthers)
        return quiet >= grace ? .stop : .stopping(stopsIn: grace - max(0, quiet))
    }
}
