import Foundation

/// `POST /reports` (packages/shared/src/report.ts): what the user wrote, what the app knows
/// about itself, and its own recent log.
public struct ProblemReportRequest: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable {
        /// The user chose Report a Problem….
        case user
        /// The app noticed it had stopped responding.
        case hang
    }

    public struct App: Codable, Equatable, Sendable {
        public var version: String
        public var build: String
        /// "release" or "dev", like `DeviceApp` on the server.
        public var flavor: String

        public init(version: String, build: String, flavor: String) {
            self.version = version
            self.build = build
            self.flavor = flavor
        }
    }

    public struct System: Codable, Equatable, Sendable {
        public var os: String
        public var model: String

        public init(os: String, model: String) {
            self.os = os
            self.model = model
        }
    }

    public var kind: Kind
    public var message: String
    public var app: App
    public var system: System
    public var diagnostics: [String: String]
    public var log: String

    public init(kind: Kind, message: String, app: App, system: System, diagnostics: [String: String], log: String) {
        self.kind = kind
        self.message = message
        self.app = app
        self.system = system
        self.diagnostics = diagnostics
        self.log = log
    }
}

public struct ProblemReportResponse: Codable, Equatable, Sendable {
    public var id: String
    public var receivedAt: Date
}

public enum ProblemReport {
    /// The server's limits (`PROBLEM_REPORT_LOG_LIMIT` and friends).
    public static let logLimit = 1_000_000
    public static let messageLimit = 4000
    public static let diagnosticsLimit = 100
    public static let diagnosticValueLimit = 2000

    /// The newest lines that fit in `limit` characters, oldest first, with a note when some were left out.
    public static func log(_ lines: [String], limit: Int = logLimit) -> String {
        var kept: [String] = []
        var size = 0
        for line in lines.reversed() {
            let cost = line.count + 1
            if size + cost > limit - 80 { break }
            kept.append(line)
            size += cost
        }
        let dropped = lines.count - kept.count
        let body = kept.reversed().joined(separator: "\n")
        return dropped > 0 ? "[\(dropped) older lines left out]\n" + body : body
    }

    /// Fits the request within the server's limits: message and values cut, at most 100 diagnostics.
    public static func fitted(_ request: ProblemReportRequest) -> ProblemReportRequest {
        var request = request
        request.message = String(request.message.trimmingCharacters(in: .whitespacesAndNewlines).prefix(messageLimit))
        let keys = request.diagnostics.keys.sorted().prefix(diagnosticsLimit)
        request.diagnostics = Dictionary(uniqueKeysWithValues: keys.map { key in
            (String(key.prefix(80)), String((request.diagnostics[key] ?? "").prefix(diagnosticValueLimit)))
        })
        if request.log.count > logLimit {
            request.log = String(request.log.suffix(logLimit))
        }
        return request
    }

    /// The report as plain text, for saving to a file when it can't be sent.
    public static func text(_ request: ProblemReportRequest) -> String {
        var out = "BoringTalks problem report (\(request.kind.rawValue))\n"
        out += "App: \(request.app.version) (\(request.app.build)) \(request.app.flavor)\n"
        out += "System: \(request.system.os) \(request.system.model)\n\n"
        out += request.message.isEmpty ? "(no message)\n" : request.message + "\n"
        out += "\nDiagnostics\n"
        for key in request.diagnostics.keys.sorted() {
            out += "  \(key): \(request.diagnostics[key] ?? "")\n"
        }
        if !request.log.isEmpty {
            out += "\nLog\n" + request.log + "\n"
        }
        return out
    }

    /// "4 min 12 s", "38 s".
    public static func describe(seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded())
        if total < 60 { return "\(total) s" }
        let minutes = total / 60, rest = total % 60
        if minutes < 60 { return rest == 0 ? "\(minutes) min" : "\(minutes) min \(rest) s" }
        return "\(minutes / 60) h \(minutes % 60) min"
    }
}
