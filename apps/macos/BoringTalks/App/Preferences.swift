import Foundation
import Observation

/// User settings, kept in UserDefaults.
@MainActor @Observable
final class Preferences {
    /// ISO code the speech model is steered to; empty means detect it.
    var language: String {
        didSet { defaults.set(language, forKey: "language") }
    }

    /// Upload the meeting audio too (the dashboard can then play it back). Without a
    /// local transcript the audio goes up anyway, for the server to transcribe.
    var uploadAudio: Bool {
        didSet { defaults.set(uploadAudio, forKey: "uploadAudio") }
    }

    /// Days a recording stays on this Mac after it has uploaded; 0 deletes it at once.
    var keepAudioDays: Int {
        didSet { defaults.set(keepAudioDays, forKey: "keepAudioDays") }
    }

    /// Record "You" with the Mac's own microphone when the system microphone is a
    /// Bluetooth headset, so the headset doesn't drop to call quality while recording.
    var avoidBluetoothMic: Bool {
        didSet { defaults.set(avoidBluetoothMic, forKey: "avoidBluetoothMic") }
    }

    /// Stop the recording when nobody has spoken for this many minutes; 0 never stops.
    var silenceStopMinutes: Int {
        didSet { defaults.set(silenceStopMinutes, forKey: "silenceStopMinutes") }
    }

    /// Transcribe on this Mac (Parakeet). Off: record both sides on their own channels and let
    /// the server transcribe the audio after the meeting.
    var transcribeOnMac: Bool {
        didSet { defaults.set(transcribeOnMac, forKey: "transcribeOnMac") }
    }

    /// Ask to record when a call app (Zoom, Teams, a browser…) starts using the microphone.
    var offerToRecordCalls: Bool {
        didSet { defaults.set(offerToRecordCalls, forKey: "offerToRecordCalls") }
    }

    /// Record a call app's call (Zoom, Teams…, not a browser) as soon as it starts, without asking.
    var autoRecordCalls: Bool {
        didSet { defaults.set(autoRecordCalls, forKey: "autoRecordCalls") }
    }

    /// Stop the recording shortly after the call's app releases the microphone.
    var stopWhenCallEnds: Bool {
        didSet { defaults.set(stopWhenCallEnds, forKey: "stopWhenCallEnds") }
    }

    /// Call apps (by name) never to ask about.
    var ignoredCallApps: [String] {
        didSet { defaults.set(ignoredCallApps, forKey: "ignoredCallApps") }
    }

    /// Bundle IDs of call apps BoringTalks doesn't know, set with `defaults write … extraCallApps`.
    var extraCallApps: [String] { defaults.stringArray(forKey: "extraCallApps") ?? [] }

    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        language = defaults.string(forKey: "language") ?? ""
        uploadAudio = defaults.object(forKey: "uploadAudio") as? Bool ?? true
        keepAudioDays = defaults.object(forKey: "keepAudioDays") as? Int ?? 7
        avoidBluetoothMic = defaults.object(forKey: "avoidBluetoothMic") as? Bool ?? true
        silenceStopMinutes = max(0, defaults.object(forKey: "silenceStopMinutes") as? Int ?? 5)
        transcribeOnMac = defaults.object(forKey: "transcribeOnMac") as? Bool ?? true
        offerToRecordCalls = defaults.object(forKey: "offerToRecordCalls") as? Bool ?? true
        autoRecordCalls = defaults.object(forKey: "autoRecordCalls") as? Bool ?? false
        stopWhenCallEnds = defaults.object(forKey: "stopWhenCallEnds") as? Bool ?? true
        ignoredCallApps = defaults.stringArray(forKey: "ignoredCallApps") ?? []
    }

    var languageCode: String? { language.isEmpty ? nil : language }
}
