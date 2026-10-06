import BoringTalksKit
import Foundation
import XCTest

/// Answers URLSession requests in tests: the API and the presigned storage PUT.
final class StubURLProtocol: URLProtocol {
    struct Recorded {
        var request: URLRequest
        var body: Data?
    }

    typealias Handler = (URLRequest, Data?) throws -> (Int, Data)

    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler: Handler?
    nonisolated(unsafe) private static var recorded: [Recorded] = []

    static func install(_ handler: @escaping Handler) {
        lock.withLock {
            self.handler = handler
            recorded = []
        }
    }

    static var requests: [Recorded] { lock.withLock { recorded } }

    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let body = request.httpBody ?? request.httpBodyStream.map(Self.read)
        let handler = Self.lock.withLock { () -> Handler? in
            Self.recorded.append(Recorded(request: request, body: body))
            return Self.handler
        }
        do {
            guard let handler, let url = request.url else { throw URLError(.badServerResponse) }
            let (status, data) = try handler(request, body)
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                           headerFields: ["Content-Type": "application/json"])
            if let response { client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed) }
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    private static func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

enum Fixture {
    static func data(_ name: String) throws -> Data {
        let bundle = Bundle(for: StubURLProtocol.self)
        let url = try XCTUnwrap(bundle.url(forResource: name, withExtension: "json"), "missing fixture \(name).json")
        return try Data(contentsOf: url)
    }

    static func json(_ data: Data?) throws -> [String: Any] {
        let object = try JSONSerialization.jsonObject(with: XCTUnwrap(data))
        return try XCTUnwrap(object as? [String: Any])
    }
}

/// A clock tests move by hand.
final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current: Date

    init(_ start: Date = Date(timeIntervalSince1970: 1_790_000_000)) {
        current = start
    }

    var now: Date { lock.withLock { current } }

    func advance(_ seconds: TimeInterval) {
        lock.withLock { current = current.addingTimeInterval(seconds) }
    }
}

func temporaryFolder() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("BoringTalksTests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}
