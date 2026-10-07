import XCTest
@testable import BoringTalksKit

final class CallSignalsTests: XCTestCase {
    private let zoom = CallApp(name: "Zoom", isBrowser: false)
    private let chrome = CallApp(name: "Chrome", isBrowser: true)

    func testRecognizesCallAppsAndTheirHelpers() {
        XCTAssertEqual(CallApps.identify("us.zoom.xos")?.name, "Zoom")
        XCTAssertEqual(CallApps.identify("com.microsoft.teams2")?.name, "Teams")
        XCTAssertEqual(CallApps.identify("com.google.Chrome.helper"), chrome)
        XCTAssertEqual(CallApps.identify("com.apple.WebKit.GPU")?.name, "Safari")
        XCTAssertEqual(CallApps.identify("com.apple.avconferenced")?.name, "FaceTime")
        XCTAssertEqual(CallApps.identify("com.tinyspeck.slackmacgap.helper")?.name, "Slack")
        XCTAssertNil(CallApps.identify("com.apple.CoreSpeech"))
        XCTAssertNil(CallApps.identify("com.apple.VoiceMemos"))
        XCTAssertEqual(CallApps.identify("com.example.Huddle", extra: ["com.example.Huddle"])?.name, "Huddle")
        XCTAssertNil(CallApps.identify("com.example.Huddle", extra: [""]))
    }

    func testOffersOnceTheAppHasHeldTheMicForAWhile() {
        var signals = CallSignals()
        XCTAssertEqual(signals.update(active: [zoom], now: 100, isRecording: false), [])
        XCTAssertEqual(signals.update(active: [zoom], now: 104, isRecording: false), [])
        XCTAssertEqual(signals.update(active: [zoom], now: 105, isRecording: false), [.offer(app: "Zoom")])
        XCTAssertEqual(signals.pendingOffer, "Zoom")
        XCTAssertEqual(signals.update(active: [zoom], now: 200, isRecording: false), [])
    }

    func testBrowsersWaitLonger() {
        var signals = CallSignals()
        _ = signals.update(active: [chrome], now: 0, isRecording: false)
        XCTAssertEqual(signals.update(active: [chrome], now: 10, isRecording: false), [])
        XCTAssertEqual(signals.update(active: [chrome], now: 15, isRecording: false), [.offer(app: "Chrome")])
    }

    func testAShortVoiceClipIsIgnored() {
        var signals = CallSignals()
        _ = signals.update(active: [chrome], now: 0, isRecording: false)
        XCTAssertEqual(signals.update(active: [], now: 8, isRecording: false), [])
        XCTAssertEqual(signals.update(active: [], now: 30, isRecording: false), [])
    }

    func testWithdrawsWhenTheCallEndsUnanswered() {
        var signals = CallSignals()
        _ = signals.update(active: [zoom], now: 0, isRecording: false)
        _ = signals.update(active: [zoom], now: 5, isRecording: false)
        XCTAssertEqual(signals.update(active: [], now: 60, isRecording: false), [.withdraw(app: "Zoom")])
        XCTAssertNil(signals.pendingOffer)
    }

    func testNotNowLastsUntilTheAppReleasesTheMic() {
        var signals = CallSignals()
        _ = signals.update(active: [zoom], now: 0, isRecording: false)
        _ = signals.update(active: [zoom], now: 5, isRecording: false)
        signals.declineOffer()
        XCTAssertEqual(signals.update(active: [zoom], now: 600, isRecording: false), [])
        // The next call asks again.
        XCTAssertEqual(signals.update(active: [], now: 700, isRecording: false), [])
        _ = signals.update(active: [zoom], now: 800, isRecording: false)
        XCTAssertEqual(signals.update(active: [zoom], now: 805, isRecording: false), [.offer(app: "Zoom")])
    }

    func testOneQuestionWhenABrowserHoldsTheMicToo() {
        var signals = CallSignals()
        _ = signals.update(active: [zoom, chrome], now: 0, isRecording: false)
        XCTAssertEqual(signals.update(active: [zoom, chrome], now: 20, isRecording: false), [.offer(app: "Zoom")])
        signals.declineOffer()
        XCTAssertEqual(signals.update(active: [zoom, chrome], now: 40, isRecording: false), [])
    }

    func testIgnoredAppsAndSwitchedOff() {
        var signals = CallSignals()
        signals.ignored = ["Zoom"]
        _ = signals.update(active: [zoom], now: 0, isRecording: false)
        XCTAssertEqual(signals.update(active: [zoom], now: 10, isRecording: false), [])

        var off = CallSignals()
        off.offersEnabled = false
        _ = off.update(active: [zoom], now: 0, isRecording: false)
        XCTAssertEqual(off.update(active: [zoom], now: 10, isRecording: false), [])
    }

    func testNoOfferWhileRecording() {
        var signals = CallSignals()
        _ = signals.update(active: [zoom], now: 0, isRecording: true)
        XCTAssertEqual(signals.update(active: [zoom], now: 10, isRecording: true), [])
        XCTAssertNil(signals.pendingOffer)
    }

    func testTheRecordedCallEndsWhenItsAppReleasesTheMic() {
        var signals = CallSignals()
        _ = signals.update(active: [zoom], now: 0, isRecording: false)
        _ = signals.update(active: [zoom], now: 5, isRecording: false)
        signals.recordingStarted(now: 6)
        XCTAssertEqual(signals.callApp, "Zoom")
        XCTAssertNil(signals.pendingOffer)
        XCTAssertEqual(signals.update(active: [zoom], now: 100, isRecording: true), [])
        XCTAssertEqual(signals.update(active: [], now: 200, isRecording: true), [.callEnded(app: "Zoom")])
        XCTAssertEqual(signals.update(active: [], now: 202, isRecording: true), [])
        XCTAssertEqual(signals.update(active: [zoom], now: 210, isRecording: true), [.callResumed(app: "Zoom")])
        signals.recordingStopped()
        XCTAssertNil(signals.callApp)
        XCTAssertEqual(signals.update(active: [], now: 300, isRecording: false), [])
    }

    func testAStoppedRecordingIsNotOfferedAgainDuringTheSameCall() {
        var signals = CallSignals()
        signals.recordingStarted(now: 0)
        _ = signals.update(active: [zoom], now: 0, isRecording: true)
        _ = signals.update(active: [zoom], now: 10, isRecording: true)
        signals.recordingStopped()
        XCTAssertEqual(signals.update(active: [zoom], now: 20, isRecording: false), [])
        _ = signals.update(active: [], now: 30, isRecording: false)
        _ = signals.update(active: [zoom], now: 40, isRecording: false)
        XCTAssertEqual(signals.update(active: [zoom], now: 45, isRecording: false), [.offer(app: "Zoom")])
    }

    func testARecordingStartedBeforeTheCallAdoptsIt() {
        var signals = CallSignals()
        signals.recordingStarted(now: 0)
        XCTAssertNil(signals.callApp)
        _ = signals.update(active: [chrome], now: 10, isRecording: true)
        XCTAssertNil(signals.callApp)
        _ = signals.update(active: [chrome], now: 25, isRecording: true)
        XCTAssertEqual(signals.callApp, "Chrome")
        XCTAssertEqual(signals.update(active: [], now: 900, isRecording: true), [.callEnded(app: "Chrome")])
    }

    func testOtherAppsComingAndGoingDontEndTheCall() {
        var signals = CallSignals()
        _ = signals.update(active: [zoom], now: 0, isRecording: true)
        _ = signals.update(active: [zoom], now: 5, isRecording: true)
        XCTAssertEqual(signals.update(active: [zoom, chrome], now: 30, isRecording: true), [])
        XCTAssertEqual(signals.update(active: [zoom], now: 40, isRecording: true), [])
    }
}

final class CallEndWatchTests: XCTestCase {
    func testKeepsRecordingUntilTheCallEnds() {
        XCTAssertEqual(CallEndWatch().verdict(lastOthers: 0, now: 10_000), .recording)
    }

    func testStopsWhenTheOthersStayQuietAfterTheHangUp() {
        var watch = CallEndWatch(grace: 30)
        watch.callEnded(at: 100)
        XCTAssertEqual(watch.verdict(lastOthers: 90, now: 100), .stopping(stopsIn: 30))
        XCTAssertEqual(watch.verdict(lastOthers: 90, now: 120), .stopping(stopsIn: 10))
        XCTAssertEqual(watch.verdict(lastOthers: 90, now: 130), .stop)
    }

    func testOthersStillTalkingPostponeIt() {
        // A browser that releases the mic on mute: the call goes on, the others are heard.
        var watch = CallEndWatch(grace: 30)
        watch.callEnded(at: 100)
        XCTAssertEqual(watch.verdict(lastOthers: 125, now: 130), .stopping(stopsIn: 25))
        XCTAssertEqual(watch.verdict(lastOthers: 125, now: 155), .stop)
    }

    func testCancelAndRepeatedEnds() {
        var watch = CallEndWatch(grace: 30)
        watch.callEnded(at: 100)
        watch.callEnded(at: 120)
        XCTAssertEqual(watch.endedAt, 100)
        watch.cancel()
        XCTAssertEqual(watch.verdict(lastOthers: 0, now: 500), .recording)
    }
}
