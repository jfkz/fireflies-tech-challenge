import AVFoundation
import BoringTalksKit

/// Writes the meeting as one AAC file, on a queue of its own so the audio threads never
/// wait for the encoder: both channels mixed to mono (16 kHz, 32 kbps, about 14 MB an
/// hour), or, when the server is to transcribe it, split into stereo with the microphone
/// left and system audio right (48 kbps, about 22 MB an hour).
final class RecordingWriter: @unchecked Sendable {
    let url: URL
    private let queue = DispatchQueue(label: "games.cutthecheese.boringtalks.writer", qos: .utility)
    // Queue-confined.
    private var file: AVAudioFile?
    private var mixer: AudioMixer
    private let format: AVAudioFormat
    private var framesWritten = 0
    private static let log = Log.logger("writer")

    static func settings(tracks: Int) -> [String: Any] {
        [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: tracks,
            AVEncoderBitRateKey: tracks == 2 ? 48000 : 32000,
        ]
    }

    init(url: URL, split: Bool = false) throws {
        self.url = url
        mixer = AudioMixer(layout: split ? .split : .mixed)
        guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000,
                                         channels: AVAudioChannelCount(mixer.trackCount), interleaved: false) else {
            throw CocoaError(.featureUnsupported)
        }
        self.format = format
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        file = try AVAudioFile(forWriting: url, settings: Self.settings(tracks: mixer.trackCount),
                               commonFormat: .pcmFormatFloat32, interleaved: false)
    }

    func append(_ samples: [Float], from channel: AudioChannel) {
        queue.async {
            self.mixer.append(samples, to: channel)
            self.write(self.mixer.drainTracks())
        }
    }

    /// A channel that couldn't start: mix without waiting for it.
    func remove(_ channel: AudioChannel) {
        queue.async {
            self.mixer.remove(channel)
            self.write(self.mixer.drainTracks())
        }
    }

    /// Writes what is left and closes the file. Returns the seconds written.
    func finish() async -> TimeInterval {
        await withCheckedContinuation { continuation in
            queue.async {
                self.write(self.mixer.drainTracks(flush: true))
                self.file?.close()
                self.file = nil
                continuation.resume(returning: Double(self.framesWritten) / 16000)
            }
        }
    }

    /// Writes equally long tracks (one per file channel).
    private func write(_ tracks: [[Float]]) {
        guard let file, let length = tracks.first?.count, length > 0 else { return }
        var offset = 0
        while offset < length {
            let count = min(16000, length - offset)
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)),
                  let channels = buffer.floatChannelData else { return }
            buffer.frameLength = AVAudioFrameCount(count)
            for (index, track) in tracks.enumerated() where index < Int(format.channelCount) {
                track.withUnsafeBufferPointer { source in
                    guard let base = source.baseAddress else { return }
                    channels[index].update(from: base + offset, count: count)
                }
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
