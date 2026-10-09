import Foundation

/// What went wrong talking to the API, sorted by what to do about it.
public enum APIError: Error, Equatable, LocalizedError {
    /// 401: the device token is missing, revoked or expired. Sign in again.
    case unauthorized
    /// 404: the meeting is gone (deleted from the dashboard).
    case notFound
    /// 409: the request was already done (e.g. a meeting completed twice).
    case conflict
    /// Another 4xx: the request itself is wrong; retrying won't help.
    case rejected(status: Int, message: String)
    /// 5xx or 429: the server is unwell or busy; retry later.
    case server(status: Int, message: String)
    /// No connection, timeout, DNS…; retry later.
    case offline(String)
    /// The response didn't have the expected shape.
    case decoding(String)

    public var isRetryable: Bool {
        switch self {
        case .server, .offline: true
        default: false
        }
    }

    public var errorDescription: String? {
        switch self {
        case .unauthorized: "Signed out — sign in again."
        case .notFound: "Not found on the server."
        case .conflict: "Already done."
        case .rejected(let status, let message): "Server refused the request (\(status)): \(message)"
        case .server(let status, let message): "Server error (\(status)): \(message)"
        case .offline(let message): "Offline: \(message)"
        case .decoding(let message): "Unexpected server response: \(message)"
        }
    }
}

public protocol DeviceAuthAPI: Sendable {
    func exchangeDeviceCode(_ request: DeviceTokenRequest) async throws -> DeviceTokenResponse
}

/// Everything the upload queue and the menu need from the API.
public protocol MeetingsAPI: Sendable {
    func createMeeting(_ request: CreateMeetingRequest, idempotencyKey: String) async throws -> CreatedMeeting
    func requestUploadURL(meetingID: String, _ request: UploadUrlRequest) async throws -> UploadUrlResponse
    /// PUTs the file to the presigned URL (straight to storage, not through the API).
    func uploadAudio(file: URL, to target: UploadUrlResponse) async throws
    func putTranscript(meetingID: String, _ transcript: TranscriptUpload) async throws
    func completeMeeting(meetingID: String, _ request: CompleteMeetingRequest) async throws
    func listMeetings(limit: Int) async throws -> MeetingPage
}

/// Sending a problem report from Report a Problem… (or after the app was stuck).
public protocol ReportsAPI: Sendable {
    func sendProblemReport(_ report: ProblemReportRequest) async throws -> ProblemReportResponse
}

/// The BoringTalks API over URLSession. Every call carries the device token as a
/// bearer token, except the presigned upload, which carries its own signature.
public final class APIClient: MeetingsAPI, DeviceAuthAPI, ReportsAPI {
    private let baseURL: URL
    private let session: URLSession
    private let token: @Sendable () async -> String?
    private let userAgent: String

    public init(baseURL: URL, session: URLSession = .shared, userAgent: String = "BoringTalks-macOS",
                token: @escaping @Sendable () async -> String?) {
        self.baseURL = baseURL
        self.session = session
        self.token = token
        self.userAgent = userAgent
    }

    // MARK: - Endpoints

    public func exchangeDeviceCode(_ request: DeviceTokenRequest) async throws -> DeviceTokenResponse {
        try await send("POST", "devices/token", body: request, authorized: false)
    }

    public func createMeeting(_ request: CreateMeetingRequest, idempotencyKey: String) async throws -> CreatedMeeting {
        try await send("POST", "meetings", body: request, headers: ["Idempotency-Key": idempotencyKey])
    }

    public func requestUploadURL(meetingID: String, _ request: UploadUrlRequest) async throws -> UploadUrlResponse {
        try await send("POST", "meetings/\(meetingID)/upload-url", body: request)
    }

    public func putTranscript(meetingID: String, _ transcript: TranscriptUpload) async throws {
        let _: Ignored = try await send("PUT", "meetings/\(meetingID)/transcript", body: transcript)
    }

    public func completeMeeting(meetingID: String, _ request: CompleteMeetingRequest) async throws {
        let _: Ignored = try await send("POST", "meetings/\(meetingID)/complete", body: request)
    }

    public func listMeetings(limit: Int) async throws -> MeetingPage {
        try await send("GET", "meetings", query: [URLQueryItem(name: "limit", value: String(limit))], body: Optional<Ignored>.none)
    }

    public func sendProblemReport(_ report: ProblemReportRequest) async throws -> ProblemReportResponse {
        try await send("POST", "reports", body: ProblemReport.fitted(report))
    }

    public func uploadAudio(file: URL, to target: UploadUrlResponse) async throws {
        var request = URLRequest(url: target.url)
        request.httpMethod = "PUT"
        for (name, value) in target.headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
        if request.value(forHTTPHeaderField: "Content-Type") == nil {
            request.setValue("audio/mp4", forHTTPHeaderField: "Content-Type")
        }
        request.timeoutInterval = 600
        let (data, response) = try await perform { try await self.session.upload(for: request, fromFile: file) }
        try check(response, data: data)
    }

    // MARK: - Plumbing

    /// Bodies the app doesn't read (or empty ones).
    struct Ignored: Codable {}

    private func send<Body: Encodable, Response: Decodable>(
        _ method: String, _ path: String, query: [URLQueryItem] = [], body: Body?,
        headers: [String: String] = [:], authorized: Bool = true
    ) async throws -> Response {
        var url = baseURL.appendingPathComponent(path)
        if !query.isEmpty, var components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            components.queryItems = query
            url = components.url ?? url
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
        if authorized {
            guard let token = await token() else { throw APIError.unauthorized }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = try APICoding.encoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await perform { try await self.session.data(for: request) }
        try check(response, data: data)
        if Response.self == Ignored.self, let ignored = Ignored() as? Response {
            return ignored
        }
        do {
            return try APICoding.decoder().decode(Response.self, from: data)
        } catch {
            throw APIError.decoding("\(method) /\(path): \(error)")
        }
    }

    private func perform(_ call: () async throws -> (Data, URLResponse)) async throws -> (Data, URLResponse) {
        do {
            return try await call()
        } catch let error as URLError {
            throw APIError.offline(error.localizedDescription)
        }
    }

    private func check(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw APIError.decoding("not an HTTP response") }
        let status = http.statusCode
        guard !(200..<300).contains(status) else { return }
        let message = (try? APICoding.decoder().decode(APIErrorBody.self, from: data))?.message
            ?? String(data: data.prefix(300), encoding: .utf8) ?? ""
        switch status {
        case 401: throw APIError.unauthorized
        case 404: throw APIError.notFound
        case 409: throw APIError.conflict
        case 408, 429, 500...: throw APIError.server(status: status, message: message)
        default: throw APIError.rejected(status: status, message: message)
        }
    }
}
