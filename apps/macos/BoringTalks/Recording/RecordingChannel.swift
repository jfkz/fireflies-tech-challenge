import AVFoundation
import BoringTalksKit

/// One side of the meeting on its way from the capture to the transcriber and
/// the recording: resampled to 16 kHz on the audio thread, then kept on the
/// meeting clock (silence fills any gap) on a serial queue of its own.
///
/// Until the speech model is ready the audio waits in a backlog and is
/// transcribed as soon as it is (up to 20 minutes; past that the meeting is left
/// for the server to transcribe from the audio).
final class RecordingChannel: @unchecked Sendable {
    let kind: AudioChannel
    let meter = LevelMeter()
    private let clockStart: TimeInterval
    private let writer: RecordingWriter
    private let queue: DispatchQueue
    /// Capture thread only.
    private let converter = BufferConverter()

    // Queue-confined.
    private var timeline = ChannelTimeline()
    private var backlog: [[Float]] = []
    private var backlogSamples = 0
    private var droppedBacklog = false
    private var transcriber: PhraseTranscriber?

    private static let backlogLimit = SpeechFormat.rate * 60 * 20

    init(kind: AudioChannel, clockStart: TimeInterval, writer: RecordingWriter) {
        self.kind = kind
        self.clockStart = clockStart
        self.writer = writer
        queue = DispatchQueue(label: "games.cutthecheese.boringtalks.\(kind.rawValue)", qos: .userInitiated)
    }

    /// Called on the capture thread; the buffer is only valid during the call.
    func ingest(_ buffer: AVAudioPCMBuffer) {
        let elapsed = ProcessInfo.processInfo.systemUptime - clockStart
        meter.push(buffer)
        guard let samples = converter.samples(buffer) else { return }
        queue.async { self.process(samples, endingAt: elapsed) }
    }

    /// Fills the silence up to now if the capture has stalled.
    func catchUp() {
        let elapsed = ProcessInfo.processInfo.systemUptime - clockStart
        queue.async {
            let silence = self.timeline.catchUp(to: elapsed)
            if silence > 0 { self.deliver([Float](repeating: 0, count: silence)) }
        }
    }

    /// Hands the backlog and everything after it to `transcriber`, in order.
    func attach(_ transcriber: PhraseTranscriber) async {
        await withCheckedContinuation { continuation in
            queue.async {
                if !self.droppedBacklog {
                    for chunk in self.backlog { transcriber.feed(chunk) }
                }
                self.backlog = []
                self.backlogSamples = 0
                self.transcriber = transcriber
                continuation.resume()
            }
        }
    }

    struct Ending {
        /// A transcriber heard all of it.
        var transcribed: Bool
        var transcriber: PhraseTranscriber?
    }

    /// After the capture stopped: brings the channel up to `elapsed` and waits for
    /// everything queued to be delivered.
    func end(at elapsed: TimeInterval) async -> Ending {
        await withCheckedContinuation { continuation in
            queue.async {
                let behind = Int(elapsed * Double(SpeechFormat.rate)) - self.timeline.written
                if behind > 0 {
                    _ = self.timeline.catchUp(to: elapsed, lag: 0)
                    self.deliver([Float](repeating: 0, count: behind))
                }
                continuation.resume(returning: Ending(transcribed: self.transcriber != nil && !self.droppedBacklog,
                                                      transcriber: self.transcriber))
            }
        }
    }

    private func process(_ samples: [Float], endingAt elapsed: TimeInterval) {
        let silence = timeline.silenceBefore(frames: samples.count, endingAt: elapsed)
        if silence > 0 { deliver([Float](repeating: 0, count: silence)) }
        deliver(samples)
    }

    private func deliver(_ chunk: [Float]) {
        writer.append(chunk, from: kind)
        if let transcriber {
            transcriber.feed(chunk)
        } else if !droppedBacklog {
            backlog.append(chunk)
            backlogSamples += chunk.count
            if backlogSamples > Self.backlogLimit {
                backlog = []
                backlogSamples = 0
                droppedBacklog = true
            }
        }
    }
}
