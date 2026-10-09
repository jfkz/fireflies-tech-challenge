import BoringTalksKit
import XCTest

final class SegmentAssemblerTests: XCTestCase {
    private func mic(_ start: Int, _ end: Int, _ text: String) -> PhraseRecord {
        PhraseRecord(channel: .microphone, voice: nil, startMs: start, endMs: end, text: text)
    }

    private func system(_ start: Int, _ end: Int, _ text: String, voice: Int?) -> PhraseRecord {
        PhraseRecord(channel: .system, voice: voice, startMs: start, endMs: end, text: text)
    }

    func testOrdersBothChannelsByTimeAndLabelsSpeakers() {
        // Arrival order is per channel (each transcriber finishes on its own).
        let phrases = [
            mic(4_000, 6_000, "Yes, we can see it."),
            mic(15_000, 17_000, "I'll send the notes."),
            system(0, 3_500, "Can everyone see my screen?", voice: 7),
            system(7_000, 10_000, "Pricing first.", voice: 3),
            system(11_000, 14_000, "Sounds good.", voice: 7),
        ]
        let segments = SegmentAssembler.assemble(phrases)
        XCTAssertEqual(segments.map(\.speaker), ["Speaker 1", "You", "Speaker 2", "Speaker 1", "You"])
        XCTAssertEqual(segments.map(\.startMs), [0, 4_000, 7_000, 11_000, 15_000])
        XCTAssertEqual(segments.first, Segment(speaker: "Speaker 1", startMs: 0, endMs: 3_500, text: "Can everyone see my screen?"))
    }

    func testSpeakerNumbersFollowFirstAppearanceNotVoiceIDs() {
        let segments = SegmentAssembler.assemble([
            system(5_000, 6_000, "Second voice.", voice: 1),
            system(0, 1_000, "First voice.", voice: 2),
        ])
        XCTAssertEqual(segments.map(\.speaker), ["Speaker 1", "Speaker 2"])
        XCTAssertEqual(segments.map(\.text), ["First voice.", "Second voice."])
    }

    func testUnknownVoiceBorrowsTheNearestSystemSpeaker() {
        let segments = SegmentAssembler.assemble([
            system(0, 1_000, "Haha.", voice: nil),
            system(2_000, 3_000, "Right, so.", voice: 4),
            mic(3_500, 4_000, "Mm-hm."),
            system(5_000, 5_500, "Yeah.", voice: nil),
        ])
        XCTAssertEqual(segments.map(\.speaker), ["Speaker 1", "Speaker 1", "You", "Speaker 1"])
    }

    func testNoVoicesAtAllIsOthers() {
        let segments = SegmentAssembler.assemble([system(0, 1_000, "Hello.", voice: nil), mic(2_000, 3_000, "Hi.")])
        XCTAssertEqual(segments.map(\.speaker), ["Others", "You"])
    }

    func testDropsMicrophoneEchoOfTheSpeakers() {
        let segments = SegmentAssembler.assemble([
            system(10_000, 14_000, "We launch on November third unless legal objects.", voice: 1),
            // The laptop microphone heard the same words a moment later.
            mic(10_400, 14_600, "we launch on november third unless legal"),
            // The user talking over them is kept.
            mic(12_000, 13_000, "Wait, which year?"),
        ])
        XCTAssertEqual(segments.map(\.speaker), ["Speaker 1", "You"])
        XCTAssertEqual(segments.last?.text, "Wait, which year?")
        XCTAssertEqual(SegmentAssembler.assemble([
            system(10_000, 14_000, "We launch on November third.", voice: 1),
            mic(10_400, 14_600, "We launch on November third."),
        ], dropEcho: false).count, 2)
    }

    func testCleansTextAndTimes() {
        let segments = SegmentAssembler.assemble([
            mic(-50, -100, "  spaced \n  out  "),
            mic(1_000, 2_000, "   "),
            system(3_000, 4_000, String(repeating: "a", count: 12_000), voice: 1),
        ])
        XCTAssertEqual(segments.count, 2)
        XCTAssertEqual(segments[0], Segment(speaker: "You", startMs: 0, endMs: 0, text: "spaced out"))
        XCTAssertEqual(segments[1].text.count, 10_000)
    }

    func testSegmentsEncodeLikeTheSharedSchema() throws {
        let upload = TranscriptUpload(language: "en", durationSec: 65, segments: [
            Segment(speaker: "Speaker 1", startMs: 0, endMs: 4_200, text: "Can everyone see my screen?"),
            Segment(speaker: "You", startMs: 4_500, endMs: 6_100, text: "Yes, go ahead."),
        ])
        let encoded = try Fixture.json(APICoding.encoder().encode(upload))
        let expected = try Fixture.json(Fixture.data("transcript-upload"))
        XCTAssertEqual(NSDictionary(dictionary: encoded), NSDictionary(dictionary: expected))
    }
}

final class SpeakerLabelerTests: XCTestCase {
    func testLabelsAreStable() {
        var labeler = SpeakerLabeler()
        XCTAssertEqual(labeler.label(channel: .system, voice: 9), "Speaker 1")
        XCTAssertEqual(labeler.label(channel: .microphone, voice: nil), "You")
        XCTAssertEqual(labeler.label(channel: .system, voice: 2), "Speaker 2")
        XCTAssertEqual(labeler.label(channel: .system, voice: 9), "Speaker 1")
        XCTAssertNil(labeler.label(channel: .system, voice: nil))
    }
}

final class ChannelTimelineTests: XCTestCase {
    func testOnTimeAudioGetsNoSilence() {
        var timeline = ChannelTimeline()
        XCTAssertEqual(timeline.silenceBefore(frames: 1_600, endingAt: 0.1), 0)
        XCTAssertEqual(timeline.silenceBefore(frames: 1_600, endingAt: 0.2), 0)
        // A little jitter is tolerated.
        XCTAssertEqual(timeline.silenceBefore(frames: 1_600, endingAt: 0.6), 0)
        XCTAssertEqual(timeline.written, 4_800)
    }

    func testLateStartAndDropoutsAreFilledWithSilence() {
        var timeline = ChannelTimeline()
        // The capture started 2 s after the meeting.
        XCTAssertEqual(timeline.silenceBefore(frames: 1_600, endingAt: 2.1), 32_000)
        XCTAssertEqual(timeline.milliseconds(timeline.written), 2_100)
        // A device change: nothing from 2.1 s to 5.0 s.
        XCTAssertEqual(timeline.silenceBefore(frames: 1_600, endingAt: 5.1), 3 * 16_000 - 1_600)
        XCTAssertEqual(timeline.milliseconds(timeline.written), 5_100)
    }

    func testCatchUpOnlyWhenWellBehind() {
        var timeline = ChannelTimeline()
        XCTAssertEqual(timeline.catchUp(to: 1.0), 0)
        XCTAssertEqual(timeline.catchUp(to: 2.0), 32_000)
        XCTAssertEqual(timeline.catchUp(to: 2.5), 0)
        // Audio that arrives after the catch-up isn't padded again.
        XCTAssertEqual(timeline.silenceBefore(frames: 1_600, endingAt: 2.1), 0)
    }
}

final class AudioMixerTests: XCTestCase {
    func testMixesAsFarAsBothChannelsGot() {
        var mixer = AudioMixer()
        mixer.gains = [.microphone: 1, .system: 1]
        mixer.append([0.1, 0.1, 0.1], to: .microphone)
        XCTAssertEqual(mixer.drain(), [])
        mixer.append([0.2, 0.2], to: .system)
        let mixed = mixer.drain()
        XCTAssertEqual(mixed.count, 2)
        XCTAssertEqual(mixed[0], 0.3, accuracy: 1e-6)
        mixer.append([0.5], to: .system)
        XCTAssertEqual(mixer.drain()[0], 0.6, accuracy: 1e-6)
    }

    func testFlushAndRemovedChannels() {
        var mixer = AudioMixer()
        mixer.gains = [.microphone: 1, .system: 1]
        mixer.append([0.1, 0.1, 0.1], to: .microphone)
        mixer.append([0.1], to: .system)
        XCTAssertEqual(mixer.drain(flush: true).count, 3)

        mixer.remove(.system)
        mixer.append([0.4, 0.4], to: .microphone)
        mixer.append([0.9], to: .system)
        XCTAssertEqual(mixer.drain(), [0.4, 0.4])
    }

    func testLoudOverlapIsLimited() {
        var mixer = AudioMixer()
        mixer.gains = [.microphone: 1, .system: 1]
        mixer.append([0.9, -0.9], to: .microphone)
        mixer.append([0.9, -0.9], to: .system)
        let mixed = mixer.drain()
        XCTAssertTrue(mixed.allSatisfy { abs($0) <= 1 })
        XCTAssertGreaterThan(mixed[0], 0.9)
        XCTAssertLessThan(mixed[1], -0.9)
    }

    func testSplitKeepsTheMicrophoneLeftAndSystemAudioRight() {
        var mixer = AudioMixer(layout: .split)
        XCTAssertEqual(mixer.trackCount, 2)
        mixer.append([0.1, 0.2, 0.3], to: .microphone)
        XCTAssertEqual(mixer.drainTracks(), [])
        mixer.append([0.9, 0.8], to: .system)
        // No gains and no limiter: each side as it was heard.
        XCTAssertEqual(mixer.drainTracks(), [[0.1, 0.2], [0.9, 0.8]])
        XCTAssertEqual(mixer.drainTracks(flush: true), [[0.3], [0]])
    }

    func testSplitWritesSilenceForASideThatIsGone() {
        var mixer = AudioMixer(layout: .split)
        mixer.remove(.system)
        mixer.append([0.5, 0.5], to: .microphone)
        XCTAssertEqual(mixer.drainTracks(), [[0.5, 0.5], [0, 0]])
        mixer.remove(.microphone)
        XCTAssertEqual(mixer.drainTracks(flush: true), [])
    }

    func testMixedTracksAreOneMix() {
        var mixer = AudioMixer()
        mixer.gains = [.microphone: 1, .system: 1]
        XCTAssertEqual(mixer.trackCount, 1)
        mixer.append([0.25], to: .microphone)
        mixer.append([0.25], to: .system)
        XCTAssertEqual(mixer.drainTracks(), [[0.5]])
    }
}

final class RecordingJanitorTests: XCTestCase {
    func testDeletesOnlyOldUnprotectedRecordings() throws {
        let folder = try temporaryFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let now = Date()
        func file(_ name: String, daysOld: Double) throws {
            let url = folder.appendingPathComponent(name)
            try Data([1, 2, 3]).write(to: url)
            try FileManager.default.setAttributes([.modificationDate: now.addingTimeInterval(-daysOld * 86_400)], ofItemAtPath: url.path)
        }
        try file("old.m4a", daysOld: 10)
        try file("waiting.m4a", daysOld: 10)
        try file("recent.m4a", daysOld: 2)
        try file("notes.txt", daysOld: 30)

        let deleted = RecordingJanitor.prune(folder: folder, keepDays: 7, protected: ["waiting.m4a"], now: now)
        XCTAssertEqual(deleted, ["old.m4a"])
        let left = try FileManager.default.contentsOfDirectory(atPath: folder.path).sorted()
        XCTAssertEqual(left, ["notes.txt", "recent.m4a", "waiting.m4a"])

        XCTAssertEqual(RecordingJanitor.prune(folder: folder, keepDays: 0, protected: [], now: now), ["recent.m4a", "waiting.m4a"])
    }
}

final class LanguageGuessTests: XCTestCase {
    func testDetectsLanguageOfLongEnoughText() {
        XCTAssertEqual(LanguageGuess.detect("Good morning everyone, let's go over the launch plan for the new pricing page."), "en")
        XCTAssertEqual(LanguageGuess.detect("Доброе утро, давайте обсудим план запуска новой страницы с ценами."), "ru")
        XCTAssertNil(LanguageGuess.detect("Okay."))
    }
}
