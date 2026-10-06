// From Talking Heads.
import AVFoundation
import Accelerate
import os

/// Loudness of one channel, written from the audio thread and read by the avatar
/// renderer every frame (deliberately not observable).
final class LevelMeter: @unchecked Sendable {
    struct Snapshot {
        /// 0...1 relative to the recent loudest sound, so quiet videos animate too.
        var level: Float
        /// 0...1 how far the sound rises above its level a moment ago: high at the
        /// start of each syllable, zero for silence and for steady music or noise.
        var syllable: Float
        /// Seconds since the sound was clearly above the background noise.
        var sinceSound: TimeInterval
    }

    private struct State {
        var level: Float = 0
        var peak: Float = -50
        var valley: Float = .nan
        var syllable: Float = 0
        var noiseFloor: Float = -70
        var lastSound: TimeInterval = -1000
    }

    private let state = OSAllocatedUnfairLock(initialState: State())

    func push(_ buffer: AVAudioPCMBuffer) {
        let frames = Int(buffer.frameLength)
        guard frames > 0 else { return }
        let stride = buffer.format.isInterleaved ? Int(buffer.format.channelCount) : 1
        var rms: Float = 0
        if let data = buffer.floatChannelData {
            vDSP_rmsqv(data[0], vDSP_Stride(stride), &rms, vDSP_Length(frames))
        } else if let data = buffer.int16ChannelData {
            var sum: Float = 0
            for i in 0..<frames {
                let v = Float(data[0][i * stride]) / 32768
                sum += v * v
            }
            rms = (sum / Float(frames)).squareRoot()
        }
        let db = 20 * log10(max(rms, 1e-7))
        let seconds = Float(frames) / Float(buffer.format.sampleRate)
        state.withLock { s in
            // Automatic gain: the recent peak (falling 4 dB/s) maps to 1, 30 dB below it to 0.
            s.peak = max(db, s.peak - 4 * seconds, -50)
            let level = db < -65 ? 0 : min(max((db - s.peak + 30) / 30, 0), 1)
            s.level = level > s.level ? level : s.level * 0.6 + level * 0.4

            // The valley follows the quiet moments between syllables and creeps up
            // 60 dB/s, so a held sound closes the mouth within a few tenths of a second.
            s.valley = s.valley.isNaN ? db : min(db, s.valley + 60 * seconds)
            // 25 dB above it is a loud, stressed syllable; ordinary ones land in between.
            let syllable = db < -60 ? 0 : min(max((db - s.valley - 3) / 22, 0), 1)
            s.syllable = syllable > s.syllable ? syllable : s.syllable * 0.5 + syllable * 0.5

            // Something is playing when it's well above the background noise, which
            // drops at once and creeps up 1 dB/s (so a fan or hum doesn't count).
            s.noiseFloor = db < s.noiseFloor ? db : min(s.noiseFloor + 1 * seconds, db)
            if db > max(s.noiseFloor + 12, -50) {
                s.lastSound = ProcessInfo.processInfo.systemUptime
            }
        }
    }

    func reset() {
        state.withLock { $0 = State() }
    }

    func snapshot() -> Snapshot {
        let now = ProcessInfo.processInfo.systemUptime
        return state.withLock { Snapshot(level: $0.level, syllable: $0.syllable, sinceSound: now - $0.lastSound) }
    }
}

/// When one avatar last got words, read by its renderer every frame.
final class SpeechClock: @unchecked Sendable {
    private let last = OSAllocatedUnfairLock<TimeInterval>(initialState: -1000)

    func mark() {
        let now = ProcessInfo.processInfo.systemUptime
        last.withLock { $0 = now }
    }

    /// Someone else is talking now.
    func reset() {
        last.withLock { $0 = -1000 }
    }

    var sinceSpeech: TimeInterval {
        ProcessInfo.processInfo.systemUptime - last.withLock { $0 }
    }
}
