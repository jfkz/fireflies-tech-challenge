import AVFoundation
import BoringTalksKit

/// Writes the meeting as one mono AAC file (16 kHz, 32 kbps, about 14 MB an hour):
/// both channels mixed, on a queue of its own so the audio threads never wait for
/// the encoder.
final class RecordingWriter: @unchecked Sendable {
    let url: URL
    private let queue = DispatchQueue(label: "games.cutthecheese.boringtalks.writer", qos: .utility)
    // Queue-confined.
    private var file: AVAudioFile?
    private var mixer = AudioMixer()
    private var framesWritten = 0
    private static let log = Log.logger("writer")

    static let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 16000,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 32000,
    ]

    init(url: URL) throws {
        self.url = url
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        file = try AVAudioFile(forWriting: url, settings: Self.settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    }

    func append(_ samples: [Float], from channel: AudioChannel) {
        queue.async {
            self.mixer.append(samples, to: channel)
            self.write(self.mixer.drain())
        }
    }

    /// A channel that couldn't start: mix without waiting for it.
    func remove(_ channel: AudioChannel) {
        queue.async {
            self.mixer.remove(channel)
            self.write(self.mixer.drain())
        }
    }

    /// Writes what is left and closes the file. Returns the seconds written.
    func finish() async -> TimeInterval {
        await withCheckedContinuation { continuation in
            queue.async {
                self.write(self.mixer.drain(flush: true))
                self.file?.close()
                self.file = nil
                continuation.resume(returning: Double(self.framesWritten) / 16000)
            }
        }
    }

    private func write(_ samples: [Float]) {
        guard let file, !samples.isEmpty else { return }
        var offset = 0
        while offset < samples.count {
            let count = min(16000, samples.count - offset)
            guard let buffer = AVAudioPCMBuffer(pcmFormat: SpeechFormat.mono16k, frameCapacity: AVAudioFrameCount(count)),
                  let channel = buffer.floatChannelData?[0] else { return }
            buffer.frameLength = AVAudioFrameCount(count)
            samples.withUnsafeBufferPointer { source in
                guard let base = source.baseAddress else { return }
                channel.update(from: base + offset, count: count)
            }
            do {
                try file.write(from: buffer)
                framesWritten += count
            } catch {
                Self.log.error("couldn't write audio: \(error.localizedDescription, privacy: .public)")
                return
            }
            offset += count
        }
    }
}
