import AVFoundation

// The speech pipeline's status type and the resampler.

/// What a model is doing, for the menu and the download progress.
struct PipelineStatus: Sendable, ExpressibleByStringLiteral {
    var text: String
    /// Set while a model downloads or loads; the fraction is nil when unknown.
    var loading: Loading?

    struct Loading: Equatable, Sendable {
        var title: String
        var fraction: Double?
    }

    init(stringLiteral text: String) {
        self.text = text
    }

    static func loading(_ title: String, fraction: Double? = nil) -> PipelineStatus {
        var status = PipelineStatus(stringLiteral: fraction.map { "\(title)… \(Int($0 * 100))%" } ?? "\(title)…")
        status.loading = Loading(title: title, fraction: fraction)
        return status
    }
}

enum SpeechFormat {
    static let rate = 16000
    /// 16 kHz mono float: what Parakeet, the voice models and the recording use.
    static let mono16k: AVAudioFormat = {
        guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false) else {
            preconditionFailure("16 kHz mono float is always a valid format")
        }
        return format
    }()
}

/// Resamples whatever the capture delivers to 16 kHz mono. Always returns a fresh
/// buffer, so the input may be a short-lived no-copy one.
final class BufferConverter {
    let format: AVAudioFormat
    private var converter: AVAudioConverter?

    init(format: AVAudioFormat = SpeechFormat.mono16k) {
        self.format = format
    }

    func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        if converter?.inputFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: format)
            converter?.primeMethod = .none
            converter?.downmix = true
        }
        guard let converter else { return nil }
        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 32
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
        var supplied = false
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, inputStatus in
            if supplied {
                inputStatus.pointee = .noDataNow
                return nil
            }
            supplied = true
            inputStatus.pointee = .haveData
            return buffer
        }
        return status == .error || output.frameLength == 0 ? nil : output
    }

    /// The samples of a converted buffer.
    func samples(_ buffer: AVAudioPCMBuffer) -> [Float]? {
        guard let converted = convert(buffer), let data = converted.floatChannelData else { return nil }
        return Array(UnsafeBufferPointer(start: data[0], count: Int(converted.frameLength)))
    }
}

/// A whole audio file as 16 kHz mono chunks of 20 ms, about the size live capture
/// delivers. The phrase cutter measures loudness per chunk, so bigger chunks would
/// hide short pauses between speakers.
enum AudioFileReader {
    static func chunks(of url: URL) throws -> [[Float]] {
        let file = try AVAudioFile(forReading: url)
        let chunkFrames = AVAudioFrameCount(max(160, file.processingFormat.sampleRate / 50))
        let converter = BufferConverter()
        var chunks: [[Float]] = []
        while file.framePosition < file.length {
            guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: chunkFrames) else { break }
            try file.read(into: buffer)
            if buffer.frameLength == 0 { break }
            if let samples = converter.samples(buffer) { chunks.append(samples) }
        }
        return chunks
    }
}
