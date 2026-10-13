import BoringTalksKit
import XCTest

final class ProblemReportTests: XCTestCase {
    private func report(message: String = "The menu froze", diagnostics: [String: String] = ["recorder.phase": "recording"],
                        log: String = "line 1\nline 2") -> ProblemReportRequest {
        ProblemReportRequest(kind: .hang, message: message, app: .init(version: "0.4.0", build: "1", flavor: "dev"),
                             system: .init(os: "macOS 26.2", model: "Mac15,3"), diagnostics: diagnostics, log: log)
    }

    func testSendsTheSharedSchema() async throws {
        StubURLProtocol.install { _, _ in
            (201, Data(#"{"id":"6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b","receivedAt":"2026-10-08T18:20:00.000Z"}"#.utf8))
        }
        let client = APIClient(baseURL: URL(string: "https://api.example.com")!, session: StubURLProtocol.session()) { "btd_test" }
        let response = try await client.sendProblemReport(report(message: "  The menu froze \n"))

        let recorded = try XCTUnwrap(StubURLProtocol.requests.first)
        XCTAssertEqual(recorded.request.httpMethod, "POST")
        XCTAssertEqual(recorded.request.url?.path, "/reports")
        XCTAssertEqual(recorded.request.value(forHTTPHeaderField: "Authorization"), "Bearer btd_test")
        let body = try Fixture.json(recorded.body) as NSDictionary
        XCTAssertEqual(body, [
            "kind": "hang",
            "message": "The menu froze",
            "app": ["version": "0.4.0", "build": "1", "flavor": "dev"],
            "system": ["os": "macOS 26.2", "model": "Mac15,3"],
            "diagnostics": ["recorder.phase": "recording"],
            "log": "line 1\nline 2",
        ] as NSDictionary)
        XCTAssertEqual(response.id, "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b")
        XCTAssertEqual(response.receivedAt, APICoding.parse("2026-10-08T18:20:00.000Z"))
    }

    func testFitsTheServersLimits() {
        let many = Dictionary(uniqueKeysWithValues: (0..<150).map { (String(format: "key.%03d", $0), String(repeating: "v", count: 3000)) })
        let fitted = ProblemReport.fitted(report(message: String(repeating: "m", count: 5000), diagnostics: many,
                                                 log: String(repeating: "l", count: 1_200_000) + "END"))
        XCTAssertEqual(fitted.message.count, 4000)
        XCTAssertEqual(fitted.diagnostics.count, 100)
        XCTAssertEqual(fitted.diagnostics["key.000"]?.count, 2000)
        XCTAssertNil(fitted.diagnostics["key.120"])
        XCTAssertEqual(fitted.log.count, 1_000_000)
        XCTAssertTrue(fitted.log.hasSuffix("END"), "keeps the newest part of the log")
    }

    func testLogKeepsTheNewestLines() {
        let lines = (1...10).map { "line \($0)" }
        XCTAssertEqual(ProblemReport.log(lines), lines.joined(separator: "\n"))
        let cut = ProblemReport.log(lines, limit: 80 + 16)
        XCTAssertEqual(cut, "[8 older lines left out]\nline 9\nline 10")
        XCTAssertEqual(ProblemReport.log([]), "")
    }

    func testTextForSavingToAFile() {
        let text = ProblemReport.text(report(diagnostics: ["b": "2", "a": "1"]))
        XCTAssertTrue(text.hasPrefix("BoringTalks problem report (hang)\nApp: 0.4.0 (1) dev\nSystem: macOS 26.2 Mac15,3\n\nThe menu froze\n"))
        XCTAssertTrue(text.contains("Diagnostics\n  a: 1\n  b: 2\n"))
        XCTAssertTrue(text.hasSuffix("Log\nline 1\nline 2\n"))
        XCTAssertTrue(ProblemReport.text(report(message: "", log: "")).contains("(no message)"))
        XCTAssertFalse(ProblemReport.text(report(log: "")).contains("Log\n"))
    }

    func testDescribesDurations() {
        XCTAssertEqual(ProblemReport.describe(seconds: 38.4), "38 s")
        XCTAssertEqual(ProblemReport.describe(seconds: 252), "4 min 12 s")
        XCTAssertEqual(ProblemReport.describe(seconds: 420), "7 min")
        XCTAssertEqual(ProblemReport.describe(seconds: 3900), "1 h 5 min")
    }
}

final class HangWatchTests: XCTestCase {
    func testAPingLeftWaitingIsAHang() {
        var detector = HangDetector(threshold: 5)
        XCTAssertEqual(detector.tick(at: 100).ping, true)
        XCTAssertNil(detector.answered(at: 100.01), "a quick answer is no hang")

        XCTAssertEqual(detector.tick(at: 101).ping, true)
        let waiting = detector.tick(at: 103)
        XCTAssertFalse(waiting.ping, "one ping at a time")
        XCTAssertNil(waiting.event)
        XCTAssertEqual(detector.tick(at: 107).event, .stalled(since: 101, seconds: 6))
        XCTAssertEqual(detector.tick(at: 500).event, .stalled(since: 101, seconds: 399))
        XCTAssertEqual(detector.answered(at: 521), .recovered(seconds: 420))
        XCTAssertNil(detector.answered(at: 522), "answered once")
        XCTAssertEqual(detector.tick(at: 522).ping, true)
    }

    func testTheLastHangIsKeptUntilCleared() throws {
        let store = HangStore(url: try temporaryFolder().appendingPathComponent("nested/last-hang.json"))
        XCTAssertNil(store.load())
        let hang = Hang(startedAt: APICoding.parse("2026-10-08T18:11:42.000Z")!, seconds: 438, recovered: false)
        store.save(hang)
        XCTAssertEqual(store.load(), hang)
        store.clear()
        XCTAssertNil(store.load())
    }

    func testTheWatchSeesABlockedMainThread() throws {
        let store = HangStore(url: try temporaryFolder().appendingPathComponent("last-hang.json"))
        let watch = HangWatch(store: store, threshold: 0.3)
        let recovered = expectation(description: "recovered")
        nonisolated(unsafe) var seen: Hang?
        watch.onRecovered = { hang in
            seen = hang
            recovered.fulfill()
        }
        watch.start(interval: 0.05)
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        Thread.sleep(forTimeInterval: 0.8)
        wait(for: [recovered], timeout: 5)
        watch.stop()
        let hang = try XCTUnwrap(seen)
        XCTAssertTrue(hang.recovered)
        XCTAssertGreaterThanOrEqual(hang.seconds, 0.5)
        // Saved too (to the millisecond, like every date the app writes).
        let saved = try XCTUnwrap(store.load())
        XCTAssertTrue(saved.recovered)
        XCTAssertEqual(saved.seconds, hang.seconds, accuracy: 0.001)
        XCTAssertEqual(saved.startedAt.timeIntervalSince1970, hang.startedAt.timeIntervalSince1970, accuracy: 0.001)
    }
}

final class DeadlineTests: XCTestCase {
    func testResultInTimeOrNil() async {
        let quick = Task { 7 }
        let quickValue = await Deadline.value(of: quick, within: .seconds(5))
        XCTAssertEqual(quickValue, 7)

        let slow = Task { () -> Int in
            try? await Task.sleep(for: .seconds(1))
            return 8
        }
        let late = await Deadline.value(of: slow, within: .milliseconds(50))
        XCTAssertNil(late)
        let eventually = await slow.value
        XCTAssertEqual(eventually, 8, "the work carries on after the deadline")
    }

    func testBlockingQueueKeepsOrderOffTheMainThread() async throws {
        let queue = BlockingQueue(label: "test")
        let order = OrderLog()
        queue.enqueue { order.append("stop") }
        let onMain = try await queue.run { () -> Bool in
            order.append("start")
            return Thread.isMainThread
        }
        XCTAssertFalse(onMain)
        XCTAssertEqual(order.items, ["stop", "start"])
        do {
            _ = try await queue.run { () -> Int in throw URLError(.cancelled) }
            XCTFail("expected the error")
        } catch {
            XCTAssertEqual((error as? URLError)?.code, .cancelled)
        }
    }
}

private final class OrderLog: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String] = []
    func append(_ value: String) { lock.withLock { values.append(value) } }
    var items: [String] { lock.withLock { values } }
}
