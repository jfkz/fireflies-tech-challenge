import AppKit
import BoringTalksKit
import Observation
import OSLog

/// Report a Problem…: what the user writes, plus the app's diagnostics and its own log, sent to
/// `POST /reports` (or saved to a file when it can't be sent). Also keeps the hang watchdog's
/// last hang, which the menu offers to report.
@MainActor @Observable
final class ProblemReporter {
    enum State: Equatable {
        case editing
        case collecting
        case sending
        case sent(reference: String)
        case saved(URL)
        case failed(String)
    }

    var message = ""
    var includeLog = true
    private(set) var kind: ProblemReportRequest.Kind = .user
    /// The hang this report is about, when it is one.
    private(set) var hang: Hang?
    /// A hang not yet reported or dismissed (the menu shows it).
    private(set) var pendingHang: Hang?
    private(set) var state: State = .editing
    /// What will be sent besides the message and the log (shown in the window).
    private(set) var diagnostics: [String: String] = [:]

    /// Gathers the diagnostics (AppModel knows the app's state).
    @ObservationIgnored var collectDiagnostics: (@MainActor () async -> [String: String])?
    /// Opens the report window.
    @ObservationIgnored var showWindow: (() -> Void)?

    @ObservationIgnored private let api: any ReportsAPI
    @ObservationIgnored private let flavor: AppFlavor
    @ObservationIgnored private let hangStore: HangStore
    @ObservationIgnored private let hangWatch: HangWatch
    private static let log = Log.logger("report")

    init(api: any ReportsAPI, flavor: AppFlavor, folders: AppFolders) {
        self.api = api
        self.flavor = flavor
        hangStore = HangStore(url: folders.root.appendingPathComponent("last-hang.json"))
        hangWatch = HangWatch(store: hangStore)
    }

    /// Starts the watchdog and picks up a hang from the last run (one that ended in a force quit).
    func start() {
        pendingHang = hangStore.load()
        hangWatch.onRecovered = { [weak self] hang in self?.pendingHang = hang }
        hangWatch.start()
    }

    // MARK: - The window

    /// Opens the window for a new report, about `hang` if given.
    func begin(about hang: Hang? = nil) {
        switch state {
        case .sent, .saved: state = .editing
        case .failed: state = .editing
        case .editing, .collecting, .sending: break
        }
        kind = hang == nil ? .user : .hang
        self.hang = hang
        showWindow?()
        refreshDiagnostics()
    }

    func dismissHang() {
        pendingHang = nil
        hangStore.clear()
    }

    func refreshDiagnostics() {
        Task {
            var values = await collectDiagnostics?() ?? [:]
            if let hang { values.merge(Self.describe(hang)) { _, new in new } }
            diagnostics = values
        }
    }

    func send() {
        guard state != .sending, state != .collecting else { return }
        Task {
            state = .collecting
            let report = await build()
            state = .sending
            do {
                let response = try await api.sendProblemReport(report)
                Self.log.notice("report \(response.id, privacy: .public) sent")
                finished()
                state = .sent(reference: String(response.id.prefix(8)))
            } catch APIError.notFound {
                // A server from before reports existed.
                state = .failed("This server doesn't take reports yet. Use Save to File… and send the file instead.")
            } catch {
                Self.log.error("report not sent: \(error.localizedDescription, privacy: .public)")
                state = .failed(error.localizedDescription)
            }
        }
    }

    /// Writes the report to Downloads and shows it in the Finder.
    func saveToFile() {
        Task {
            state = .collecting
            let report = await build()
            let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
                ?? FileManager.default.homeDirectoryForCurrentUser
            let stamp = Date().formatted(.iso8601.year().month().day().time(includingFractionalSeconds: false).timeSeparator(.omitted))
            let url = folder.appendingPathComponent("\(flavor.displayName) report \(stamp).txt")
            do {
                try ProblemReport.text(report).write(to: url, atomically: true, encoding: .utf8)
                NSWorkspace.shared.activateFileViewerSelecting([url])
                finished()
                state = .saved(url)
            } catch {
                state = .failed("Couldn't save the report: \(error.localizedDescription)")
            }
        }
    }

    /// Writes what would be sent to `url`, without sending it (`--write-report`, for checking).
    func write(to url: URL) async throws {
        try ProblemReport.text(await build()).write(to: url, atomically: true, encoding: .utf8)
    }

    /// The report is out: clear the draft and the hang it was about.
    private func finished() {
        message = ""
        if hang != nil || kind == .hang { dismissHang() }
        hang = nil
    }

    private func build() async -> ProblemReportRequest {
        var values = await collectDiagnostics?() ?? [:]
        if let hang { values.merge(Self.describe(hang)) { _, new in new } }
        diagnostics = values
        let log = includeLog ? await Task.detached { ProblemReport.log(Self.readLog()) }.value : ""
        let info = Bundle.main.infoDictionary ?? [:]
        return ProblemReportRequest(
            kind: kind,
            message: message,
            app: .init(version: info["CFBundleShortVersionString"] as? String ?? "dev",
                       build: info["CFBundleVersion"] as? String ?? "",
                       flavor: flavor == .dev ? "dev" : "release"),
            system: .init(os: Self.osVersion, model: Self.hardwareModel),
            diagnostics: values,
            log: log
        )
    }

    private static func describe(_ hang: Hang) -> [String: String] {
        [
            "hang.startedAt": APICoding.format(hang.startedAt),
            "hang.seconds": String(Int(hang.seconds.rounded())),
            "hang.recovered": hang.recovered ? "yes" : "no (the app was quit while stuck)",
        ]
    }

    // MARK: - Log and machine

    /// This run's log: everything BoringTalks wrote, plus errors from the system frameworks in
    /// its process (Core Audio's among them). Earlier runs aren't readable without admin rights.
    nonisolated static func readLog() -> [String] {
        guard let store = try? OSLogStore(scope: .currentProcessIdentifier) else { return [] }
        let start = store.position(date: Date().addingTimeInterval(-24 * 3600))
        guard let entries = try? store.getEntries(at: start) else { return [] }
        var lines: [String] = []
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        for case let entry as OSLogEntryLog in entries {
            let ours = entry.subsystem.hasPrefix(Log.subsystem)
            guard ours || entry.level == .error || entry.level == .fault else { continue }
            let source = ours ? entry.category : "\(entry.subsystem):\(entry.category)"
            lines.append("\(formatter.string(from: entry.date)) \(level(entry.level)) [\(source)] \(entry.composedMessage)")
            if lines.count > 50_000 { lines.removeFirst(10_000) }
        }
        return lines
    }

    private nonisolated static func level(_ level: OSLogEntryLog.Level) -> String {
        switch level {
        case .debug: "debug"
        case .info: "info"
        case .notice: "notice"
        case .error: "ERROR"
        case .fault: "FAULT"
        default: "-"
        }
    }

    /// "macOS 26.2 (25C56)".
    static var osVersion: String {
        let text = ProcessInfo.processInfo.operatingSystemVersionString
            .replacingOccurrences(of: "Version ", with: "")
            .replacingOccurrences(of: "Build ", with: "")
        return "macOS " + text
    }

    /// "Mac15,3".
    static var hardwareModel: String {
        var size = 0
        sysctlbyname("hw.model", nil, &size, nil, 0)
        guard size > 0 else { return "" }
        var bytes = [CChar](repeating: 0, count: size)
        sysctlbyname("hw.model", &bytes, &size, nil, 0)
        return String(cString: bytes)
    }
}
