import BoringTalksKit
import XCTest

final class APIClientTests: XCTestCase {
    private func client(token: String? = "btd_test", base: String = "https://api.example.com") -> APIClient {
        APIClient(baseURL: URL(string: base)!, session: StubURLProtocol.session(), userAgent: "BoringTalks-macOS/test") { token }
    }

    func testListMeetingsDecodesTheSharedSchema() async throws {
        StubURLProtocol.install { _, _ in (200, try Fixture.data("meeting-page")) }
        let page = try await client().listMeetings(limit: 5)

        let request = try XCTUnwrap(StubURLProtocol.requests.first?.request)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.absoluteString, "https://api.example.com/meetings?limit=5")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer btd_test")
        XCTAssertEqual(request.value(forHTTPHeaderField: "User-Agent"), "BoringTalks-macOS/test")
        XCTAssertNil(request.httpBody)

        XCTAssertEqual(page.items.count, 2)
        XCTAssertEqual(page.nextCursor, "eyJzdGFydGVkQXQiOiIyMDI2LTEwLTA1In0")
        let first = page.items[0]
        XCTAssertEqual(first.title, "Pricing review: Pro to $29, launch Nov 3")
        XCTAssertEqual(first.status, .ready)
        XCTAssertEqual(first.source, .macos)
        XCTAssertEqual(first.durationSec, 1_820)
        XCTAssertEqual(first.speakers, ["You", "Speaker 1", "Speaker 2"])
        XCTAssertEqual(first.startedAt, APICoding.parse("2026-10-06T09:30:00Z"))
        // Dates without milliseconds and null fields decode too.
        XCTAssertEqual(page.items[1].status, .summarizing)
        XCTAssertNil(page.items[1].description)
        XCTAssertNil(page.items[1].durationSec)
        XCTAssertEqual(page.items[1].startedAt, APICoding.parse("2026-10-05T16:00:00.000Z"))
    }

    func testUnknownStatusDoesNotBreakTheList() throws {
        let json = #"{"items":[{"id":"x","title":"T","description":null,"status":"archived","source":"macos","startedAt":"2026-10-06T09:30:00Z","durationSec":1,"speakers":[],"actionItemCount":0,"hasAudio":false}],"nextCursor":null}"#
        let page = try APICoding.decoder().decode(MeetingPage.self, from: Data(json.utf8))
        XCTAssertEqual(page.items.first?.status, .summarizing)
    }

    func testBotAndUnknownSourcesDoNotBreakTheList() throws {
        let item = { (source: String) in
            #"{"id":"x","title":"T","description":null,"status":"ready","source":"\#(source)","startedAt":"2026-10-06T09:30:00Z","durationSec":1,"speakers":[],"topics":[],"actionItemCount":0,"hasAudio":false}"#
        }
        let json = #"{"items":[\#(item("bot")),\#(item("telepathy"))],"nextCursor":null}"#
        let page = try APICoding.decoder().decode(MeetingPage.self, from: Data(json.utf8))
        XCTAssertEqual(page.items.map(\.source), [.bot, .unknown])
    }

    func testDeviceTokenExchangeIsUnauthenticated() async throws {
        StubURLProtocol.install { _, _ in (200, try Fixture.data("device-token-response")) }
        let response = try await client(token: nil).exchangeDeviceCode(
            DeviceTokenRequest(code: "one-time", codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r7wW1gFWFOEjXk"))

        let recorded = try XCTUnwrap(StubURLProtocol.requests.first)
        XCTAssertEqual(recorded.request.httpMethod, "POST")
        XCTAssertEqual(recorded.request.url?.path, "/devices/token")
        XCTAssertNil(recorded.request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(recorded.request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try Fixture.json(recorded.body)
        XCTAssertEqual(body as NSDictionary, ["code": "one-time", "codeVerifier": "dBjftJeZ4CVP-mB92K27uhbUJU1p1r7wW1gFWFOEjXk"])

        XCTAssertTrue(response.token.hasPrefix("btd_"))
        XCTAssertEqual(response.user.email, "mike@example.com")
    }

    func testCreateMeetingOmitsAbsentFields() async throws {
        StubURLProtocol.install { _, _ in (201, try Fixture.data("created-meeting")) }
        let created = try await client().createMeeting(
            CreateMeetingRequest(title: nil, startedAt: APICoding.parse("2026-10-06T09:30:00.250Z"), language: nil),
            idempotencyKey: "k1")
        XCTAssertEqual(created.id, "0b9a1e8e-2f4c-4d3a-9b8e-1c2d3e4f5a6b")
        let body = try Fixture.json(StubURLProtocol.requests.first?.body)
        XCTAssertEqual(body as NSDictionary, ["source": "macos", "startedAt": "2026-10-06T09:30:00.250Z"])
    }

    func testUploadURLRequestAndResponse() async throws {
        StubURLProtocol.install { _, _ in (200, try Fixture.data("upload-url-response")) }
        let target = try await client().requestUploadURL(meetingID: "m1", UploadUrlRequest(sizeBytes: 123_456))
        let recorded = try XCTUnwrap(StubURLProtocol.requests.first)
        XCTAssertEqual(recorded.request.url?.path, "/meetings/m1/upload-url")
        XCTAssertEqual(try Fixture.json(recorded.body) as NSDictionary, ["contentType": "audio/mp4", "sizeBytes": 123_456])
        XCTAssertEqual(target.headers, ["Content-Type": "audio/mp4"])
        XCTAssertEqual(target.expiresInSec, 900)
        XCTAssertEqual(target.url.host, "storage.example.com")
    }

    func testBaseURLWithAPathPrefix() async throws {
        StubURLProtocol.install { _, _ in (200, Data(#"{"items":[],"nextCursor":null}"#.utf8)) }
        _ = try await client(base: "http://localhost:3001/api").listMeetings(limit: 1)
        XCTAssertEqual(StubURLProtocol.requests.first?.request.url?.absoluteString, "http://localhost:3001/api/meetings?limit=1")
    }

    func testErrorsMapToWhatTheAppDoesAboutThem() async throws {
        let cases: [(Int, Data, APIError)] = [
            (400, try Fixture.data("error-400"), .rejected(status: 400, message: "Validation failed")),
            (401, Data(), .unauthorized),
            (403, Data(#"{"statusCode":403,"message":"Forbidden"}"#.utf8), .rejected(status: 403, message: "Forbidden")),
            (404, Data(), .notFound),
            (409, Data(), .conflict),
            (429, Data("slow down".utf8), .server(status: 429, message: "slow down")),
            (503, Data(), .server(status: 503, message: "")),
        ]
        for (status, body, expected) in cases {
            StubURLProtocol.install { _, _ in (status, body) }
            do {
                try await client().putTranscript(meetingID: "m1", TranscriptUpload(language: nil, durationSec: nil, segments: []))
                XCTFail("\(status) should throw")
            } catch {
                XCTAssertEqual(error as? APIError, expected, "status \(status)")
                XCTAssertEqual((error as? APIError)?.isRetryable, status >= 429, "status \(status)")
            }
        }
    }

    func testNoConnectionIsOffline() async {
        StubURLProtocol.install { _, _ in throw URLError(.notConnectedToInternet) }
        do {
            try await client().completeMeeting(meetingID: "m1", CompleteMeetingRequest(durationSec: 3))
            XCTFail("should throw")
        } catch let error as APIError {
            guard case .offline = error else { return XCTFail("got \(error)") }
            XCTAssertTrue(error.isRetryable)
        } catch {
            XCTFail("got \(error)")
        }
    }

    func testWithoutATokenNothingIsSent() async {
        StubURLProtocol.install { _, _ in (200, Data()) }
        do {
            _ = try await client(token: nil).listMeetings(limit: 5)
            XCTFail("should throw")
        } catch {
            XCTAssertEqual(error as? APIError, .unauthorized)
        }
        XCTAssertTrue(StubURLProtocol.requests.isEmpty)
    }

    func testEmptySuccessBodiesAreFine() async throws {
        StubURLProtocol.install { _, _ in (204, Data()) }
        try await client().completeMeeting(meetingID: "m1", CompleteMeetingRequest(durationSec: nil))
        XCTAssertEqual(try Fixture.json(StubURLProtocol.requests.first?.body) as NSDictionary, [:])
    }

    func testPresignedUploadSendsTheFileWithItsHeaders() async throws {
        let folder = try temporaryFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent("a.m4a")
        try Data(repeating: 1, count: 1_000).write(to: file)
        StubURLProtocol.install { _, _ in (200, Data()) }
        let target = try APICoding.decoder().decode(UploadUrlResponse.self, from: Fixture.data("upload-url-response"))
        try await client().uploadAudio(file: file, to: target)
        let request = try XCTUnwrap(StubURLProtocol.requests.first?.request)
        XCTAssertEqual(request.httpMethod, "PUT")
        XCTAssertEqual(request.url, target.url)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "audio/mp4")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))

        StubURLProtocol.install { _, _ in (403, Data("<Error>SignatureDoesNotMatch</Error>".utf8)) }
        do {
            try await client().uploadAudio(file: file, to: target)
            XCTFail("should throw")
        } catch {
            XCTAssertEqual(error as? APIError, .rejected(status: 403, message: "<Error>SignatureDoesNotMatch</Error>"))
        }
    }

    func testDatesUseMillisecondsAndUTC() {
        let date = Date(timeIntervalSince1970: 1_791_278_400.5)
        XCTAssertEqual(APICoding.format(date), "2026-10-06T09:20:00.500Z")
        XCTAssertEqual(APICoding.parse("2026-10-06T09:20:00.500Z"), date)
        XCTAssertEqual(APICoding.parse("2026-10-06T09:20:00Z"), Date(timeIntervalSince1970: 1_791_278_400))
        XCTAssertNil(APICoding.parse("yesterday"))
    }
}
