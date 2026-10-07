import XCTest
@testable import BoringTalksKit

final class SilenceWatchTests: XCTestCase {
    private let watch = SilenceWatch(limit: 300)

    func testListensWhileSomeoneTalks() {
        XCTAssertEqual(watch.verdict(lastActivity: 1000, now: 1010), .listening)
        XCTAssertEqual(watch.verdict(lastActivity: 1000, now: 1239), .listening)
    }

    func testWarnsInTheLastMinute() {
        XCTAssertEqual(watch.verdict(lastActivity: 1000, now: 1240), .warning(stopsIn: 60))
        XCTAssertEqual(watch.verdict(lastActivity: 1000, now: 1290), .warning(stopsIn: 10))
    }

    func testStopsAtTheLimit() {
        XCTAssertEqual(watch.verdict(lastActivity: 1000, now: 1300), .stop)
        XCTAssertEqual(watch.verdict(lastActivity: 1000, now: 5000), .stop)
    }

    func testCountsFromTheStartWhenNobodyWasEverHeard() {
        XCTAssertEqual(watch.verdict(lastActivity: 0, now: 299), .warning(stopsIn: 1))
        XCTAssertEqual(watch.verdict(lastActivity: 0, now: 300), .stop)
        XCTAssertEqual(watch.quiet(lastActivity: -1000, now: 10), 10)
    }

    func testKeepRecordingRestartsTheCount() {
        var watch = watch
        watch.keepRecording(at: 1280)
        XCTAssertEqual(watch.verdict(lastActivity: 1000, now: 1300), .listening)
        XCTAssertEqual(watch.verdict(lastActivity: 1000, now: 1580), .stop)
        // Speech after it counts as usual, and an older "keep" never moves it back.
        watch.keepRecording(at: 1100)
        XCTAssertEqual(watch.keptAt, 1280)
        XCTAssertEqual(watch.verdict(lastActivity: 1500, now: 1580), .listening)
    }

    func testOff() {
        let off = SilenceWatch(limit: 0)
        XCTAssertFalse(off.isOn)
        XCTAssertEqual(off.verdict(lastActivity: 0, now: 100_000), .listening)
    }

    func testShortLimitsWarnForHalfOfIt() {
        let short = SilenceWatch(limit: 60)
        XCTAssertEqual(short.warningLead, 30)
        XCTAssertEqual(short.verdict(lastActivity: 0, now: 29), .listening)
        XCTAssertEqual(short.verdict(lastActivity: 0, now: 30), .warning(stopsIn: 30))
    }

    func testDescribesTheLimit() {
        XCTAssertEqual(SilenceWatch.describe(300), "5 minutes")
        XCTAssertEqual(SilenceWatch.describe(60), "1 minute")
        XCTAssertEqual(SilenceWatch.describe(90), "90 seconds")
        XCTAssertEqual(SilenceWatch.describe(1), "1 second")
    }
}
