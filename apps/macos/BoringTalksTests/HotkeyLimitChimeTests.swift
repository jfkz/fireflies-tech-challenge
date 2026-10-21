import XCTest
@testable import BoringTalksKit

final class HotkeyTests: XCTestCase {
    func testReadsTheDefaultAndWritesItBack() throws {
        let hotkey = try XCTUnwrap(Hotkey(Hotkey.defaultText))
        XCTAssertEqual(hotkey.modifiers, [.control, .option, .command])
        XCTAssertEqual(hotkey.key, "R")
        XCTAssertEqual(hotkey.keyCode, 15)
        XCTAssertEqual(hotkey.carbonModifiers, 0x1000 | 0x0800 | 0x0100)
        XCTAssertEqual(hotkey.description, "⌃⌥⌘R")
    }

    func testWritesModifiersInMenuOrder() throws {
        let hotkey = try XCTUnwrap(Hotkey(modifiers: [.command, .shift, .option, .control], key: "f5"))
        XCTAssertEqual(hotkey.description, "⌃⌥⇧⌘F5")
        XCTAssertEqual(Hotkey(hotkey.description), hotkey)
        XCTAssertEqual(hotkey.keyCode, 96)
        XCTAssertEqual(Hotkey(modifiers: [.option], key: "space")?.description, "⌥Space")
    }

    func testRefusesWhatIsNotOne() {
        XCTAssertNil(Hotkey(""))
        XCTAssertNil(Hotkey("R"))
        XCTAssertNil(Hotkey("⌘"))
        XCTAssertNil(Hotkey("⌘Tab"))
        XCTAssertNil(Hotkey(modifiers: [], key: "R"))
    }

    func testKnowsKeysByTheirCode() {
        XCTAssertEqual(Hotkey.key(forKeyCode: 15), "R")
        XCTAssertEqual(Hotkey.key(forKeyCode: 26), "7")
        XCTAssertEqual(Hotkey.key(forKeyCode: 49), "Space")
        XCTAssertNil(Hotkey.key(forKeyCode: 53))
    }
}

final class RecordingLimitTests: XCTestCase {
    func testWarnsInTheLastFiveMinutesThenStops() {
        let limit = RecordingLimit(seconds: 7200)
        XCTAssertEqual(limit.verdict(elapsed: 6899), .listening)
        XCTAssertEqual(limit.verdict(elapsed: 6900), .warning(stopsIn: 300))
        XCTAssertEqual(limit.verdict(elapsed: 7200), .stop)
    }

    func testWarnsForHalfAShortLimitAndNeverWithoutOne() {
        XCTAssertEqual(RecordingLimit(seconds: 60).verdict(elapsed: 30), .warning(stopsIn: 30))
        XCTAssertEqual(RecordingLimit(seconds: 0).verdict(elapsed: 1_000_000), .listening)
        XCTAssertFalse(RecordingLimit(seconds: 0).isOn)
    }

    func testDescribesTheLimit() {
        XCTAssertEqual(RecordingLimit.describe(7200), "2 hours")
        XCTAssertEqual(RecordingLimit.describe(3600), "1 hour")
        XCTAssertEqual(RecordingLimit.describe(5400), "90 minutes")
        XCTAssertEqual(RecordingLimit.describe(60), "1 minute")
    }
}

final class ChimeTests: XCTestCase {
    func testIsAShortQuietMonoWav() {
        let wav = Chime.wav(rising: true)
        XCTAssertEqual(String(decoding: wav.prefix(4), as: UTF8.self), "RIFF")
        XCTAssertEqual(String(decoding: wav[8..<12], as: UTF8.self), "WAVE")
        let samples = (wav.count - 44) / 2
        XCTAssertEqual(Double(samples) / Double(Chime.sampleRate), Chime.duration, accuracy: 0.01)
        let values = (0..<samples).map { i in Int16(littleEndian: wav.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 44 + i * 2, as: Int16.self) }) }
        let peak = values.map { abs(Int($0)) }.max() ?? 0
        XCTAssertGreaterThan(peak, 4000)
        XCTAssertLessThanOrEqual(peak, Int(Chime.peak * 32767) + 1)
        XCTAssertEqual(values.first, 0)
    }

    func testRisesToStartAndFallsToStop() {
        func pitch(_ s: ArraySlice<Float>) -> Double {
            let a = Array(s)
            let crossings = zip(a, a.dropFirst()).filter { $0.0 <= 0 && $0.1 > 0 }.count
            return Double(crossings) / (Double(a.count) / Double(Chime.sampleRate))
        }
        let up = Chime.samples(frequencies: [659.25, 880.0])
        let half = up.count / 2
        XCTAssertLessThan(pitch(up[..<half]), pitch(up[half...]))
        XCTAssertNotEqual(Chime.wav(rising: true), Chime.wav(rising: false))
    }
}

final class MeTests: XCTestCase {
    func testReadsTheRecordingLimit() async throws {
        StubURLProtocol.install { _, _ in (200, try Fixture.data("me")) }
        let me = try await APIClient(baseURL: URL(string: "https://api.example.com")!, session: StubURLProtocol.session()) { "btd_test" }.me()
        XCTAssertEqual(StubURLProtocol.requests.first?.request.url?.path, "/me")
        XCTAssertEqual(me.email, "mike@example.com")
        XCTAssertEqual(me.recordingLimit, .seconds(7200))
        XCTAssertEqual(me.recordingLimitMinutes(fallback: 5), 120)
    }

    func testTellsNoLimitFromAnOlderAPI() throws {
        func read(_ json: String) throws -> Me { try APICoding.decoder().decode(Me.self, from: Data(json.utf8)) }
        let base = #""id":"x","email":null,"name":null,"emailOnReady":true,"createdAt":"2026-10-01T09:00:00.000Z""#
        XCTAssertEqual(try read("{\(base),\"recordingLimitSec\":null}").recordingLimitMinutes(fallback: 120), 0)
        XCTAssertEqual(try read("{\(base)}").recordingLimitMinutes(fallback: 120), 120)
        XCTAssertEqual(try read("{\(base),\"recordingLimitSec\":20}").recordingLimitMinutes(fallback: 120), 1)
        let me = try read("{\(base),\"recordingLimitSec\":null}")
        XCTAssertEqual(try read(String(decoding: APICoding.encoder().encode(me), as: UTF8.self)), me)
    }
}
