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

    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        language = defaults.string(forKey: "language") ?? ""
        uploadAudio = defaults.object(forKey: "uploadAudio") as? Bool ?? true
        keepAudioDays = defaults.object(forKey: "keepAudioDays") as? Int ?? 7
        avoidBluetoothMic = defaults.object(forKey: "avoidBluetoothMic") as? Bool ?? true
        silenceStopMinutes = max(0, defaults.object(forKey: "silenceStopMinutes") as? Int ?? 5)
    }

    var languageCode: String? { language.isEmpty ? nil : language }
}
