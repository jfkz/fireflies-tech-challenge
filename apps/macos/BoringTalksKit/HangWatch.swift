import Foundation

/// A time the main thread stopped answering: the menu, the buttons and the call detection
/// were frozen.
public struct Hang: Codable, Equatable, Sendable {
    public var startedAt: Date
    public var seconds: TimeInterval
    /// False while it lasts, and when the app was quit or killed before it came back.
    public var recovered: Bool

    public init(startedAt: Date, seconds: TimeInterval, recovered: Bool) {
        self.startedAt = startedAt
        self.seconds = seconds
        self.recovered = recovered
    }
}

/// Pings to the main thread and their answers, on a monotonic clock (seconds of uptime,
/// which stand still while the Mac sleeps, so sleep is never a hang).
public struct HangDetector: Sendable {
    public enum Event: Equatable, Sendable {
        /// The ping sent at `since` has been waiting `seconds`.
        case stalled(since: TimeInterval, seconds: TimeInterval)
        /// The main thread answered after `seconds`.
        case recovered(seconds: TimeInterval)
    }

    public let threshold: TimeInterval
    /// When the ping still waiting for an answer was sent.
    private var outstanding: TimeInterval?

    public init(threshold: TimeInterval) {
        self.threshold = threshold
    }

    /// A check from the watchdog: send a ping when none is waiting, else say whether the
    /// waiting one is late.
    public mutating func tick(at now: TimeInterval) -> (ping: Bool, event: Event?) {
        guard let sent = outstanding else {
            outstanding = now
            return (true, nil)
        }
        let waited = now - sent
        return (false, waited >= threshold ? .stalled(since: sent, seconds: waited) : nil)
    }

    /// The main thread ran the ping.
    public mutating func answered(at now: TimeInterval) -> Event? {
        guard let sent = outstanding else { return nil }
        outstanding = nil
        let waited = now - sent
        return waited >= threshold ? .recovered(seconds: waited) : nil
    }
}

/// The last hang not yet reported or dismissed, kept on disk so one that ended with the app
/// being force-quit is still offered for a report on the next launch.
public struct HangStore: Sendable {
    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    public func load() -> Hang? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? APICoding.decoder().decode(Hang.self, from: data)
    }

    public func save(_ hang: Hang) {
        guard let data = try? APICoding.encoder().encode(hang) else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }

    public func clear() {
        try? FileManager.default.removeItem(at: url)
    }
}

/// Watches the main thread from a background queue: a ping goes to the main queue every
/// second, and one left waiting `threshold` seconds is a hang. It is logged and saved while it
/// lasts (in case the app is killed), and handed to `onRecovered` when it ends.
public final class HangWatch: @unchecked Sendable {
    /// On the main thread, after a hang ended. Set before `start`.
    public var onRecovered: (@MainActor (Hang) -> Void)?

    private let store: HangStore
    private let queue = DispatchQueue(label: "games.cutthecheese.boringtalks.hang-watch", qos: .utility)
    private let lock = NSLock()
    private var detector: HangDetector
    private var timer: DispatchSourceTimer?
    // Queue-confined.
    private var current: Hang?
    private var savedAt: TimeInterval = 0
    private static let log = Log.logger("hang")

    public init(store: HangStore, threshold: TimeInterval = 5) {
        self.store = store
        detector = HangDetector(threshold: threshold)
    }

    public func start(interval: TimeInterval = 1) {
        guard timer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + interval, repeating: interval, leeway: .milliseconds(250))
        timer.setEventHandler { [weak self] in self?.tick() }
        timer.resume()
        self.timer = timer
    }

    public func stop() {
        timer?.cancel()
        timer = nil
    }

    private static var uptime: TimeInterval { ProcessInfo.processInfo.systemUptime }

    private func tick() {
        let now = Self.uptime
        lock.lock()
        let (ping, event) = detector.tick(at: now)
        lock.unlock()
        if ping {
            DispatchQueue.main.async { [weak self] in self?.answer() }
        }
        guard case .stalled(_, let seconds) = event else { return }
        if var hang = current {
            // Keep the file current every few seconds while it lasts.
            guard now - savedAt >= 5 else { return }
            hang.seconds = seconds
            current = hang
            store.save(hang)
            savedAt = now
        } else {
            let hang = Hang(startedAt: Date().addingTimeInterval(-seconds), seconds: seconds, recovered: false)
            current = hang
            store.save(hang)
            savedAt = now
            Self.log.error("the main thread has not answered for \(Int(seconds), privacy: .public) s")
        }
    }

    /// On the main thread.
    private func answer() {
        lock.lock()
        let event = detector.answered(at: Self.uptime)
        lock.unlock()
        guard case .recovered(let seconds) = event else { return }
        queue.async { [weak self] in
            guard let self else { return }
            var hang = current ?? Hang(startedAt: Date().addingTimeInterval(-seconds), seconds: seconds, recovered: false)
            current = nil
            hang.seconds = seconds
            hang.recovered = true
            store.save(hang)
            Self.log.error("the main thread was stuck for \(Int(seconds), privacy: .public) s")
            DispatchQueue.main.async { [weak self] in
                MainActor.assumeIsolated { self?.onRecovered?(hang) }
            }
        }
    }
}
