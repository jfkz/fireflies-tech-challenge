import BoringTalksKit
import XCTest

/// The API and the storage bucket, answering through StubURLProtocol.
private final class FakeServer: @unchecked Sendable {
    static let meetingID = "0b9a1e8e-2f4c-4d3a-9b8e-1c2d3e4f5a6b"
    private let lock = NSLock()
    /// Planned answers per route ("POST /meetings/…/complete"), used up in order;
    /// nil = no connection. Unlisted calls succeed.
    private var planned: [String: [Int?]] = [:]

    func plan(_ route: String, _ statuses: Int?...) {
        lock.withLock { planned[route, default: []].append(contentsOf: statuses) }
    }

    var routes: [String] {
        StubURLProtocol.requests.map { Self.route(of: $0.request) }
    }

    static func route(of request: URLRequest) -> String {
        let path = request.url?.path ?? ""
        if request.url?.host == "storage.example.com" { return "\(request.httpMethod ?? "") storage" }
        return "\(request.httpMethod ?? "") \(path)"
    }

    func install() {
        StubURLProtocol.install { [self] request, _ in
            let route = Self.route(of: request)
            let next: Int?? = lock.withLock {
                guard var queue = planned[route], !queue.isEmpty else { return .none }
                let status = queue.removeFirst()
                planned[route] = queue
                return .some(status)
            }
            if case .some(let status) = next {
                guard let status else { throw URLError(.notConnectedToInternet) }
                if status >= 300 {
                    let body = status == 400 ? try Fixture.data("error-400") : Data(#"{"statusCode":\#(status),"message":"Nope"}"#.utf8)
                    return (status, body)
                }
            }
            switch route {
            case "POST /meetings": return (201, try Fixture.data("created-meeting"))
            case "POST /meetings/\(Self.meetingID)/upload-url": return (200, try Fixture.data("upload-url-response"))
            case "PUT storage": return (200, Data())
            case "PUT /meetings/\(Self.meetingID)/transcript": return (200, Data(#"{"ok":true}"#.utf8))
            case "POST /meetings/\(Self.meetingID)/complete": return (202, Data("{}".utf8))
            default: return (404, Data(#"{"statusCode":404,"message":"Not Found"}"#.utf8))
            }
        }
    }
}

final class UploadQueueTests: XCTestCase {
    private var folder: URL!
    private var server: FakeServer!
    private var clock: TestClock!
    private var store: InMemoryUploadStore!
    private let id = FakeServer.meetingID

    override func setUpWithError() throws {
        folder = try temporaryFolder()
        server = FakeServer()
        server.install()
        clock = TestClock()
        store = InMemoryUploadStore()
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: folder)
    }

    private func makeQueue(store: (any UploadStore)? = nil, keepAudioDays: Int = 7, token: String? = "btd_test") -> UploadQueue {
        let api = APIClient(baseURL: URL(literal: "https://api.example.com"), session: StubURLProtocol.session()) { token }
        let clock = clock!
        return UploadQueue(api: api, store: store ?? self.store, recordings: folder, keepAudioDays: keepAudioDays,
                           now: { clock.now })
    }

    private func meeting(segments: [Segment]? = nil, audio: Bool = true, uploadAudio: Bool = true) throws -> PendingMeeting {
        let pending = PendingMeeting(
            id: UUID(), title: "Weekly sync", startedAt: Date(timeIntervalSince1970: 1_791_278_400), durationSec: 65,
            language: "en",
            segments: segments ?? [
                Segment(speaker: "Speaker 1", startMs: 0, endMs: 4_200, text: "Can everyone see my screen?"),
                Segment(speaker: "You", startMs: 4_500, endMs: 6_100, text: "Yes, go ahead."),
            ],
            audioFileName: audio ? "\(UUID().uuidString).m4a" : nil, uploadAudio: uploadAudio
        )
        if let name = pending.audioFileName {
            try Data(repeating: 7, count: 2_048).write(to: folder.appendingPathComponent(name))
        }
        return pending
    }

    // MARK: - Happy paths

    func testUploadsEveryStepInOrder() async throws {
        let queue = makeQueue()
        let item = try meeting()
        await queue.enqueue(item)
        await queue.processDue()

        XCTAssertEqual(server.routes, [
            "POST /meetings", "POST /meetings/\(id)/upload-url", "PUT storage",
            "PUT /meetings/\(id)/transcript", "POST /meetings/\(id)/complete",
        ])
        let snapshot = await queue.current
        XCTAssertTrue(snapshot.items.isEmpty)
        XCTAssertEqual(snapshot.uploadedCount, 1)
        XCTAssertEqual(snapshot.lastUploadedRemoteID, id)
        XCTAssertEqual(try store.load(), [])

        let requests = StubURLProtocol.requests
        // API calls carry the device token; the presigned PUT carries only its own headers.
        for recorded in requests where FakeServer.route(of: recorded.request) != "PUT storage" {
            XCTAssertEqual(recorded.request.value(forHTTPHeaderField: "Authorization"), "Bearer btd_test")
        }
        let put = try XCTUnwrap(requests.first { FakeServer.route(of: $0.request) == "PUT storage" })
        XCTAssertNil(put.request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(put.request.value(forHTTPHeaderField: "Content-Type"), "audio/mp4")
        XCTAssertEqual(put.request.url?.query, "X-Amz-Signature=abc")

        let create = try Fixture.json(requests[0].body)
        XCTAssertEqual(create["source"] as? String, "macos")
        XCTAssertEqual(create["title"] as? String, "Weekly sync")
        XCTAssertEqual(create["language"] as? String, "en")
        XCTAssertEqual(create["startedAt"] as? String, "2026-10-06T09:20:00.000Z")
        XCTAssertEqual(requests[0].request.value(forHTTPHeaderField: "Idempotency-Key"), item.id.uuidString)

        let uploadURL = try Fixture.json(requests[1].body)
        XCTAssertEqual(uploadURL["contentType"] as? String, "audio/mp4")
        XCTAssertEqual(uploadURL["sizeBytes"] as? Int, 2_048)
        XCTAssertNil(uploadURL["channels"], "a mono mix says nothing about channels")

        let transcript = try Fixture.json(requests[3].body)
        XCTAssertEqual(NSDictionary(dictionary: transcript), NSDictionary(dictionary: try Fixture.json(Fixture.data("transcript-upload"))))
        XCTAssertEqual(try Fixture.json(requests[4].body)["durationSec"] as? Int, 65)

        // Audio stays on this Mac for the "keep" period.
        XCTAssertTrue(FileManager.default.fileExists(atPath: folder.appendingPathComponent(item.audioFileName ?? "").path))
    }

    func testAudioOffSkipsTheAudioStep() async throws {
        let queue = makeQueue()
        await queue.enqueue(try meeting(uploadAudio: false))
        await queue.processDue()
        XCTAssertEqual(server.routes, ["POST /meetings", "PUT /meetings/\(id)/transcript", "POST /meetings/\(id)/complete"])
    }

    func testWithoutTranscriptTheAudioGoesUpForTheServerToTranscribe() async throws {
        let queue = makeQueue()
        await queue.enqueue(try meeting(segments: [], uploadAudio: false))
        await queue.processDue()
        XCTAssertEqual(server.routes, ["POST /meetings", "POST /meetings/\(id)/upload-url", "PUT storage", "POST /meetings/\(id)/complete"])
    }

    func testTwoChannelRecordingTellsTheServerWhichSideIsWhich() async throws {
        let queue = makeQueue()
        var item = try meeting(segments: [])
        item.audioChannels = .micSystem
        await queue.enqueue(item)
        await queue.processDue()
        XCTAssertEqual(server.routes, ["POST /meetings", "POST /meetings/\(id)/upload-url", "PUT storage", "POST /meetings/\(id)/complete"])
        let request = try XCTUnwrap(StubURLProtocol.requests.first { FakeServer.route(of: $0.request).hasSuffix("/upload-url") })
        XCTAssertEqual(try Fixture.json(request.body)["channels"] as? String, "mic-system")
    }

    func testOlderQueuedMeetingsStillLoad() throws {
        let json = #"[{"id":"7E1F2C3A-0000-4000-8000-000000000001","startedAt":"2026-10-06T09:20:00.000Z","durationSec":5,"segments":[],"audioFileName":"x.m4a","uploadAudio":true,"step":"audio","isFailed":false,"attempts":0}]"#
        let items = try APICoding.decoder().decode([PendingMeeting].self, from: Data(json.utf8))
        XCTAssertNil(items.first?.audioChannels)
    }

    func testMissingAudioFileIsSkipped() async throws {
        let queue = makeQueue()
        var item = try meeting()
        item.audioFileName = "gone.m4a"
        await queue.enqueue(item)
        await queue.processDue()
        XCTAssertEqual(server.routes, ["POST /meetings", "PUT /meetings/\(id)/transcript", "POST /meetings/\(id)/complete"])
    }

    func testNothingToUploadFails() async throws {
        let queue = makeQueue()
        await queue.enqueue(try meeting(segments: [], audio: false))
        await queue.processDue()
        XCTAssertEqual(server.routes, [])
        let state1 = await queue.current
        let item = try XCTUnwrap(state1.items.first)
        XCTAssertTrue(item.isFailed)
    }

    func testKeepAudioZeroDeletesTheFileAfterUpload() async throws {
        let queue = makeQueue(keepAudioDays: 0)
        let item = try meeting()
        await queue.enqueue(item)
        await queue.processDue()
        XCTAssertFalse(FileManager.default.fileExists(atPath: folder.appendingPathComponent(item.audioFileName ?? "").path))
    }

    // MARK: - Resuming

    func testResumesFromEachStepAfterRelaunch() async throws {
        let expectations: [(PendingMeeting.Step, [String])] = [
            (.audio, ["POST /meetings/\(id)/upload-url", "PUT storage", "PUT /meetings/\(id)/transcript", "POST /meetings/\(id)/complete"]),
            (.transcript, ["PUT /meetings/\(id)/transcript", "POST /meetings/\(id)/complete"]),
            (.complete, ["POST /meetings/\(id)/complete"]),
        ]
        for (step, routes) in expectations {
            server.install()
            var item = try meeting()
            item.remoteID = id
            item.step = step
            let file = FileUploadStore(url: folder.appendingPathComponent("uploads-\(step.rawValue).json"))
            try file.save([item])

            // A fresh queue, as after a relaunch.
            let queue = makeQueue(store: file)
            await queue.load()
            let state2 = await queue.current
            XCTAssertEqual(state2.items.first?.step, step)
            await queue.processDue()
            XCTAssertEqual(server.routes, routes, "resuming at \(step)")
            XCTAssertEqual(try file.load(), [])
        }
    }

    func testAStepWithoutServerIDStartsOver() async throws {
        let queue = makeQueue()
        var item = try meeting(uploadAudio: false)
        item.step = .transcript
        await queue.enqueue(item)
        await queue.processDue()
        XCTAssertEqual(server.routes, ["POST /meetings", "PUT /meetings/\(id)/transcript", "POST /meetings/\(id)/complete"])
    }

    func testPersistsProgressAfterEveryStep() async throws {
        let file = FileUploadStore(url: folder.appendingPathComponent("uploads.json"))
        let queue = makeQueue(store: file)
        server.plan("POST /meetings/\(id)/complete", 503)
        await queue.enqueue(try meeting(uploadAudio: false))
        await queue.processDue()
        let saved = try XCTUnwrap(try file.load().first)
        XCTAssertEqual(saved.remoteID, id)
        XCTAssertEqual(saved.step, .complete)
        XCTAssertEqual(saved.attempts, 1)
    }

    // MARK: - Failures

    func testServerErrorsRetryWithBackoffWithoutRepeatingDoneSteps() async throws {
        let queue = makeQueue()
        server.plan("PUT /meetings/\(id)/transcript", 503, 502)
        await queue.enqueue(try meeting(uploadAudio: false))

        await queue.processDue()
        let state3 = await queue.current
        var item = try XCTUnwrap(state3.items.first)
        XCTAssertEqual(item.step, .transcript)
        XCTAssertEqual(item.attempts, 1)
        XCTAssertEqual(item.nextAttemptAt, clock.now.addingTimeInterval(5))
        XCTAssertFalse(item.isFailed)

        // Not due yet: nothing happens.
        await queue.processDue()
        XCTAssertEqual(server.routes.count, 2)

        clock.advance(5)
        await queue.processDue()
        let state4 = await queue.current
        item = try XCTUnwrap(state4.items.first)
        XCTAssertEqual(item.attempts, 2)
        XCTAssertEqual(item.nextAttemptAt, clock.now.addingTimeInterval(10))
        let due = await queue.nextDueDate()
        XCTAssertEqual(due, item.nextAttemptAt)

        clock.advance(10)
        await queue.processDue()
        let state5 = await queue.current
        XCTAssertTrue(state5.items.isEmpty)
        // The meeting was created once, whatever happened after.
        XCTAssertEqual(server.routes.filter { $0 == "POST /meetings" }.count, 1)
    }

    func testOfflineWaitsAndReconnectingRetriesAtOnce() async throws {
        let queue = makeQueue()
        server.plan("POST /meetings", nil)
        await queue.enqueue(try meeting(uploadAudio: false))
        await queue.processDue()
        var snapshot = await queue.current
        XCTAssertEqual(snapshot.items.first?.lastError?.hasPrefix("Offline"), true)
        XCTAssertEqual(snapshot.waiting, 1)

        await queue.setOnline(false)
        clock.advance(60)
        await queue.processDue()
        XCTAssertEqual(server.routes.count, 1)

        await queue.setOnline(true)
        snapshot = await queue.current
        XCTAssertNil(snapshot.items.first?.nextAttemptAt)
        await queue.processDue()
        let state6 = await queue.current
        XCTAssertTrue(state6.items.isEmpty)
    }

    func testUnauthorizedPausesEverythingUntilSignedInAgain() async throws {
        let queue = makeQueue()
        server.plan("POST /meetings", 401)
        await queue.enqueue(try meeting(uploadAudio: false))
        await queue.enqueue(try meeting(uploadAudio: false))
        await queue.processDue()
        var snapshot = await queue.current
        XCTAssertTrue(snapshot.needsSignIn)
        XCTAssertEqual(snapshot.waiting, 2)
        XCTAssertEqual(server.routes, ["POST /meetings"])

        await queue.resume()
        await queue.processDue()
        snapshot = await queue.current
        XCTAssertFalse(snapshot.needsSignIn)
        XCTAssertTrue(snapshot.items.isEmpty)
        XCTAssertEqual(snapshot.uploadedCount, 2)
    }

    func testNoTokenCountsAsSignedOut() async throws {
        let queue = makeQueue(token: nil)
        await queue.enqueue(try meeting())
        await queue.processDue()
        let state7 = await queue.current
        XCTAssertTrue(state7.needsSignIn)
        XCTAssertEqual(server.routes, [])
    }

    func testMeetingDeletedOnTheServerIsDropped() async throws {
        let queue = makeQueue()
        server.plan("PUT /meetings/\(id)/transcript", 404)
        await queue.enqueue(try meeting(uploadAudio: false))
        await queue.processDue()
        let state8 = await queue.current
        XCTAssertTrue(state8.items.isEmpty)
        XCTAssertEqual(server.routes.last, "PUT /meetings/\(id)/transcript")
    }

    func testAlreadyCompletedCountsAsDone() async throws {
        let queue = makeQueue()
        server.plan("POST /meetings/\(id)/complete", 409)
        await queue.enqueue(try meeting(uploadAudio: false))
        await queue.processDue()
        let snapshot = await queue.current
        XCTAssertTrue(snapshot.items.isEmpty)
        XCTAssertEqual(snapshot.uploadedCount, 1)
    }

    func testRejectedRequestFailsUntilRetried() async throws {
        let queue = makeQueue()
        server.plan("PUT /meetings/\(id)/transcript", 400)
        await queue.enqueue(try meeting(uploadAudio: false))
        await queue.processDue()
        let state9 = await queue.current
        let failed = try XCTUnwrap(state9.items.first)
        XCTAssertTrue(failed.isFailed)
        XCTAssertEqual(failed.step, .transcript)
        XCTAssertEqual(failed.lastError, "Server refused the request (400): Validation failed")

        clock.advance(3_600)
        await queue.processDue()
        XCTAssertEqual(server.routes.count, 2, "a failed meeting waits for the user")

        await queue.retry(failed.id)
        await queue.processDue()
        let state10 = await queue.current
        XCTAssertTrue(state10.items.isEmpty)
    }

    func testDiscardRemovesAMeeting() async throws {
        let queue = makeQueue()
        let item = try meeting()
        await queue.setOnline(false)
        await queue.enqueue(item)
        let files11 = await queue.protectedFiles
        XCTAssertEqual(files11, [item.audioFileName ?? ""])
        await queue.discard(item.id)
        let state12 = await queue.current
        XCTAssertTrue(state12.items.isEmpty)
        XCTAssertEqual(try store.load(), [])
    }

    func testBackgroundLoopUploadsWhatIsEnqueued() async throws {
        let queue = makeQueue()
        await queue.start()
        await queue.enqueue(try meeting(uploadAudio: false))
        for _ in 0..<100 {
            if await queue.current.items.isEmpty { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        await queue.stop()
        let state13 = await queue.current
        XCTAssertTrue(state13.items.isEmpty)
    }
}

final class PendingMeetingTests: XCTestCase {
    func testStepsSkipWhatThereIsNothingFor() {
        var item = PendingMeeting(title: nil, startedAt: Date(), durationSec: 1, language: nil,
                                  segments: [Segment(speaker: "You", startMs: 0, endMs: 1, text: "Hi")],
                                  audioFileName: "a.m4a", uploadAudio: true)
        XCTAssertEqual(item.step(after: .create, audioExists: true), .audio)
        XCTAssertEqual(item.step(after: .create, audioExists: false), .transcript)
        XCTAssertEqual(item.step(after: .audio, audioExists: true), .transcript)
        XCTAssertEqual(item.step(after: .transcript, audioExists: true), .complete)
        XCTAssertEqual(item.step(after: .complete, audioExists: true), .done)
        item.segments = []
        XCTAssertEqual(item.step(after: .audio, audioExists: true), .complete)
        XCTAssertTrue(item.hasContent(audioExists: true))
        XCTAssertFalse(item.hasContent(audioExists: false))
    }

    func testBackoffDoublesUpToTheCap() {
        let backoff = Backoff()
        XCTAssertEqual(backoff.delay(afterAttempts: 0), 0)
        XCTAssertEqual(backoff.delay(afterAttempts: 1), 5)
        XCTAssertEqual(backoff.delay(afterAttempts: 2), 10)
        XCTAssertEqual(backoff.delay(afterAttempts: 5), 80)
        XCTAssertEqual(backoff.delay(afterAttempts: 9), 900)
        XCTAssertEqual(backoff.delay(afterAttempts: 1_000), 900)
    }

    func testFileStoreRoundTrip() throws {
        let folder = try temporaryFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = FileUploadStore(url: folder.appendingPathComponent("nested/uploads.json"))
        XCTAssertEqual(try store.load(), [])
        var item = PendingMeeting(title: "T", startedAt: Date(timeIntervalSince1970: 1_791_278_400.123), durationSec: 5,
                                  language: "en", segments: [], audioFileName: "x.m4a", uploadAudio: false)
        item.remoteID = "r1"
        item.step = .complete
        item.nextAttemptAt = Date(timeIntervalSince1970: 1_791_278_500)
        try store.save([item])
        let loaded = try store.load()
        XCTAssertEqual(loaded.first?.remoteID, "r1")
        XCTAssertEqual(loaded.first?.step, .complete)
        XCTAssertEqual(loaded.first?.startedAt.timeIntervalSince1970 ?? 0, 1_791_278_400.123, accuracy: 0.001)
    }
}
