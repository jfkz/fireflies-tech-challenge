import Foundation

/// Keeps one channel's samples on the meeting clock.
///
/// Both channels count 16 kHz samples from the meeting start, so a sample index
/// is a time. A capture that starts late, drops out (a device change, a sleeping
/// Bluetooth headset) or stalls would put that channel behind the other; the gap
/// is filled with silence so both stay within half a second of the shared clock.
public struct ChannelTimeline: Equatable, Sendable {
    public let sampleRate: Double
    /// How far behind the clock a channel may fall before silence is inserted.
    public let tolerance: TimeInterval
    /// Samples written so far, silence included.
    public private(set) var written = 0

    public init(sampleRate: Double = 16000, tolerance: TimeInterval = 0.5) {
        self.sampleRate = sampleRate
        self.tolerance = tolerance
    }

    /// `frames` samples arrived, ending `elapsed` seconds after the meeting start.
    /// Returns how many samples of silence go in front of them.
    public mutating func silenceBefore(frames: Int, endingAt elapsed: TimeInterval) -> Int {
        let expectedEnd = Int((elapsed * sampleRate).rounded())
        let gap = expectedEnd - (written + frames)
        let silence = gap > Int(tolerance * sampleRate) ? gap : 0
        written += silence + frames
        return silence
    }

    /// Nothing arrived for a while: the silence that brings the channel up to
    /// `elapsed`, or 0 while it is within `lag` of it.
    public mutating func catchUp(to elapsed: TimeInterval, lag: TimeInterval = 1.5) -> Int {
        let behind = Int((elapsed * sampleRate).rounded()) - written
        guard behind > Int(lag * sampleRate) else { return 0 }
        written += behind
        return behind
    }

    /// Sample position → milliseconds from the meeting start.
    public func milliseconds(_ sample: Int) -> Int {
        Int((Double(sample) * 1000 / sampleRate).rounded())
    }
}

/// Mixes the two channels into the mono track that is saved and uploaded.
/// Both arrive on the same clock (see `ChannelTimeline`), so sample *n* of one
/// plays with sample *n* of the other; whatever one channel has that the other
/// hasn't delivered yet waits here.
public struct AudioMixer: Sendable {
    private var pending: [AudioChannel: [Float]] = [:]
    private var active: Set<AudioChannel>
    /// Gain per channel; the call is usually quieter than the user's own microphone.
    public var gains: [AudioChannel: Float] = [.microphone: 0.8, .system: 1.0]

    public init(channels: Set<AudioChannel> = Set(AudioChannel.allCases)) {
        active = channels
    }

    public mutating func append(_ samples: [Float], to channel: AudioChannel) {
        guard active.contains(channel) else { return }
        pending[channel, default: []].append(contentsOf: samples)
    }

    /// A channel that stopped for good (its capture failed): mix without it.
    public mutating func remove(_ channel: AudioChannel) {
        active.remove(channel)
        pending[channel] = nil
    }

    /// Mixed samples ready to write: as far as every active channel has got, or
    /// everything with `flush` (the end of the meeting).
    public mutating func drain(flush: Bool = false) -> [Float] {
        guard !active.isEmpty else { return [] }
        let lengths = active.map { pending[$0]?.count ?? 0 }
        let count = flush ? (lengths.max() ?? 0) : (lengths.min() ?? 0)
        guard count > 0 else { return [] }
        var mixed = [Float](repeating: 0, count: count)
        for channel in active {
            guard let samples = pending[channel] else { continue }
            let gain = gains[channel] ?? 1
            let available = min(count, samples.count)
            for index in 0..<available {
                mixed[index] += samples[index] * gain
            }
            pending[channel] = Array(samples.dropFirst(available))
        }
        // Soft limit instead of hard clipping when both sides talk at once.
        for index in mixed.indices where abs(mixed[index]) > 0.9 {
            mixed[index] = mixed[index] > 0 ? 0.9 + 0.1 * tanh((mixed[index] - 0.9) * 10)
                                            : -0.9 - 0.1 * tanh((-mixed[index] - 0.9) * 10)
        }
        return mixed
    }
}
