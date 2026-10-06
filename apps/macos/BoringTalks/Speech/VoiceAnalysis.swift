import Accelerate
import BoringTalksKit
import Foundation
import class FluidAudio.DiarizerManager
import struct FluidAudio.DiarizerModels
import SpeakerKit
import os

// From Talking Heads, without the avatar genders: who said a phrase.

/// Who said a phrase, as far as the transcriber can tell.
struct SpeakerTag: Equatable, Sendable {
    /// Stable id of a recognized voice; nil while it isn't known yet.
    var voice: Int?
    /// How the voice sounds, e.g. "high 205 Hz · lively · warm · clear".
    var description: String?
    /// Which phrase the text belongs to; a phrase is finished in the background
    /// while the next one is already shown.
    var phrase: Int?
    /// Pitch of the words themselves (Hz), known at once, while the voice may not be.
    var pitch: Float?
    /// Not recognized because it is like no voice heard so far: someone new.
    var unfamiliar = false
}

enum Pitch {
    /// Median fundamental frequency (Hz) of the voiced parts of 16 kHz audio, found with
    /// the YIN method; nil when too little of it is voiced.
    static func median(_ samples: ArraySlice<Float>) -> Float? {
        let rate: Float = 16000
        let frame = 800, hop = 480
        let minLag = 40, maxLag = 228 // 400 Hz … 70 Hz
        guard samples.count >= frame + maxLag else { return nil }
        let x = Array(samples)

        var energy: Float = 0
        vDSP_rmsqv(x, 1, &energy, vDSP_Length(x.count))
        let gate = max(energy * 0.5, 1e-3)

        var difference = [Float](repeating: 0, count: maxLag + 1)
        var normalized = [Float](repeating: 1, count: maxLag + 1)
        var pitches: [Float] = []
        var start = 0
        x.withUnsafeBufferPointer { buffer in
            guard let base = buffer.baseAddress else { return }
            while start + frame + maxLag <= x.count, pitches.count < 200 {
                defer { start += hop }
                var rms: Float = 0
                vDSP_rmsqv(base + start, 1, &rms, vDSP_Length(frame))
                guard rms > gate else { continue }
                for lag in 1...maxLag {
                    vDSP_distancesq(base + start, 1, base + start + lag, 1, &difference[lag], vDSP_Length(frame))
                }
                var running: Float = 0
                for lag in 1...maxLag {
                    running += difference[lag]
                    normalized[lag] = difference[lag] * Float(lag) / max(running, 1e-9)
                }
                var lag = minLag
                while lag <= maxLag {
                    if normalized[lag] < 0.15 {
                        while lag < maxLag, normalized[lag + 1] < normalized[lag] { lag += 1 }
                        pitches.append(rate / Float(lag))
                        break
                    }
                    lag += 1
                }
            }
        }
        guard pitches.count >= 5 else { return nil }
        return pitches.sorted()[pitches.count / 2]
    }
}

/// One speaker's stretch of a phrase, in samples of the phrase.
struct VoiceTurn: Sendable {
    var range: Range<Int>
}

/// Splits a phrase where the speaker changes, with SpeakerKit (pyannote).
actor VoiceIdentifier {
    static let shared = VoiceIdentifier()

    private var kit: SpeakerKit?
    private var loading: Task<SpeakerKit, Error>?
    private static let log = Log.logger("voices")

    var isReady: Bool { kit != nil }

    func prepare(folder: URL) async throws {
        if kit != nil { return }
        if let loading {
            kit = try await loading.value
            return
        }
        let task = Task {
            try await SpeakerKit(PyannoteConfig(downloadBase: folder.path, download: true, load: true, verbose: false))
        }
        loading = task
        do {
            kit = try await task.value
        } catch {
            loading = nil
            throw error
        }
    }

    /// Who speaks when in a phrase, so each person's words become their own segment.
    /// Turns shorter than 0.8 s are folded into a neighbour; together the turns
    /// cover the whole phrase.
    func turns(in phrase: [Float]) async -> [VoiceTurn] {
        let whole = [VoiceTurn(range: 0..<phrase.count)]
        guard let kit, !phrase.isEmpty else { return whole }
        // The embedder works on 10 s windows, so repeat a short phrase to fill one;
        // turns are read from the first copy.
        var samples = phrase
        while samples.count < 16000 * 12 { samples += phrase }
        let duration = Float(phrase.count) / 16000
        guard let result = try? await kit.diarize(audioArray: samples, options: PyannoteDiarizationOptions()) else {
            Self.log.notice("diarization failed")
            return whole
        }

        typealias Span = (speaker: Int, start: Float, end: Float)
        func merged(_ spans: [Span]) -> [Span] {
            spans.reduce(into: [Span]()) { out, span in
                if let last = out.last, last.speaker == span.speaker {
                    out[out.count - 1].end = max(last.end, span.end)
                } else {
                    out.append(span)
                }
            }
        }
        var spans = merged(result.segments
            .compactMap { segment -> Span? in
                guard let id = segment.speaker.speakerId, segment.startTime < duration - 0.05 else { return nil }
                return (id, segment.startTime, min(segment.endTime, duration))
            }
            .sorted { $0.start < $1.start })
        while spans.count > 1, let short = spans.firstIndex(where: { $0.end - $0.start < 0.8 }) {
            if short > 0 {
                spans[short - 1].end = max(spans[short - 1].end, spans[short].end)
            } else {
                spans[1].start = spans[0].start
            }
            spans.remove(at: short)
            spans = merged(spans)
        }
        guard !spans.isEmpty else { return whole }

        // Cut between turns halfway through the gap (or overlap).
        var turns: [VoiceTurn] = []
        var start = 0
        for (index, span) in spans.enumerated() {
            let end = index == spans.count - 1
                ? phrase.count
                : min(phrase.count, max(start, Int((span.end + spans[index + 1].start) / 2 * 16000)))
            turns.append(VoiceTurn(range: start..<end))
            start = end
        }
        return turns.filter { !$0.range.isEmpty }
    }
}

/// What is known about one stretch of a voice.
struct VoiceSample: Sendable {
    /// WeSpeaker embedding: who it is.
    var embedding: [Float]
    /// Pitch, intonation, timbre, brightness, breathiness: how it sounds.
    var traits: VoiceTraits?
}

/// Remembers the voices heard on the call and recognizes them again.
///
/// Who is who comes from WeSpeaker embeddings. Talking Heads fitted the thresholds
/// on 514 clips of 1.2–5 s from 40 LibriSpeech speakers: on one such clip a voice
/// is mistaken 3.2 % of the time, and in simulated conversations of 2–4 people
/// 3.4 % of phrases went to the wrong speaker.
///
/// For a meeting, voices are never forgotten, so "Speaker 2" stays Speaker 2 for
/// the whole meeting. Thread-safe: phrases are identified from several tasks.
final class VoiceRegistry: @unchecked Sendable {
    private struct Voice {
        let id: Int
        /// Sum of the embeddings of its confident phrases; its direction is the voice.
        var sum: [Float]
        var phrases: Int
        var traits: VoiceTraits?
        var lastHeard: TimeInterval

        var tag: SpeakerTag {
            SpeakerTag(voice: id, description: traits.map(VoiceRegistry.describe))
        }
    }

    private var voices: [Voice] = []
    private var nextID = 1
    private let lock = NSLock()
    private let maxVoices: Int
    /// Voices not heard for this long are forgotten (nil: never, as in a meeting).
    private let forgetAfter: TimeInterval?
    private static let log = Log.logger("voices")
    /// Closer than this: surely the same person, and the voice learns from the phrase.
    private let sameDistance: Float = 0.61
    /// Further than this from everyone: a new person. In between: the nearest voice,
    /// without learning from a phrase that might be someone else's.
    private let newDistance: Float = 0.74

    init(maxVoices: Int = 10, forgetAfter: TimeInterval? = nil) {
        self.maxVoices = maxVoices
        self.forgetAfter = forgetAfter
    }

    var count: Int { lock.withLock { voices.count } }

    /// A finished phrase: match its voice or remember a new one.
    func identify(_ sample: VoiceSample) -> SpeakerTag {
        lock.withLock { identifyLocked(sample) }
    }

    private func identifyLocked(_ sample: VoiceSample) -> SpeakerTag {
        let now = ProcessInfo.processInfo.systemUptime
        if let forgetAfter {
            voices.removeAll { now - $0.lastHeard > forgetAfter }
        }
        let unit = Self.normalized(sample.embedding)
        let distances = voices.map { Self.distance($0.sum, unit) }
        let nearest = distances.indices.min { distances[$0] < distances[$1] }
        Self.log.debug("voice distances \(distances.map { String(format: "%.2f", $0) }.joined(separator: " "), privacy: .public)")
        if PhraseTranscriber.trace {
            FileHandle.standardError.write(Data("TRACE identify distances \(distances.map { String(format: "%.2f", $0) }.joined(separator: " "))\n".utf8))
        }

        // Laughter, music or noise that came out as words has no voice to learn
        // from: it neither starts a new voice nor changes one.
        let speech = (sample.traits?.voicedFrames ?? 0) >= 50
        let index: Int
        if let nearest, distances[nearest] < newDistance || voices.count >= maxVoices || !speech {
            index = nearest
            if distances[nearest] < sameDistance, speech {
                learn(sample, unit: unit, into: index)
            }
        } else if !speech {
            return SpeakerTag(voice: nil)
        } else {
            voices.append(Voice(id: nextID, sum: unit, phrases: 1, traits: sample.traits, lastHeard: now))
            nextID += 1
            index = voices.count - 1
        }
        voices[index].lastHeard = now
        return voices[index].tag
    }

    /// A phrase still being heard: the known voice it matches, without learning from
    /// it, or an unknown voice.
    func match(_ sample: VoiceSample) -> SpeakerTag {
        lock.withLock {
            let unit = Self.normalized(sample.embedding)
            let nearest = voices.min { Self.distance($0.sum, unit) < Self.distance($1.sum, unit) }
            if let nearest, Self.distance(nearest.sum, unit) < newDistance {
                return nearest.tag
            }
            // Someone new only on a second of real speech, not a laugh.
            let speech = (sample.traits?.voicedFrames ?? 0) >= 50
            return SpeakerTag(voice: nil, unfamiliar: !voices.isEmpty && speech)
        }
    }

    /// "205 Hz · lively · breathy": how a voice sounds.
    static func describe(_ traits: VoiceTraits) -> String {
        var parts: [String] = []
        if let pitch = traits.pitch {
            let height = pitch < 110 ? "deep" : pitch < 160 ? "low" : pitch < 220 ? "high" : "very high"
            parts.append("\(height) \(Int(pitch)) Hz")
        }
        if let range = traits.pitchRange {
            parts.append(range < 2.75 ? "flat" : range < 4.4 ? "even" : "lively")
        }
        parts.append(traits.brightness < 410 ? "dark" : traits.brightness < 560 ? "warm" : "bright")
        parts.append(traits.breathiness < 0.075 ? "clear" : traits.breathiness < 0.094 ? "soft" : "breathy")
        return parts.joined(separator: " · ")
    }

    private func learn(_ sample: VoiceSample, unit: [Float], into index: Int) {
        // Long enough to settle, short enough to follow a voice that changes a bit.
        let keep = Float(min(voices[index].phrases, 30)) / Float(voices[index].phrases)
        voices[index].sum = zip(voices[index].sum, unit).map { $0 * keep + $1 }
        voices[index].phrases += 1
        if let traits = sample.traits {
            if voices[index].traits == nil {
                voices[index].traits = traits
            } else {
                voices[index].traits?.merge(traits)
            }
        }
    }

    private static func normalized(_ v: [Float]) -> [Float] {
        var norm: Float = 0
        vDSP_svesq(v, 1, &norm, vDSP_Length(v.count))
        let length = max(norm.squareRoot(), 1e-9)
        return v.map { $0 / length }
    }

    /// Cosine distance between two embeddings, normalized or not.
    static func distance(between a: [Float], and b: [Float]) -> Float {
        distance(a, normalized(b))
    }

    /// Cosine distance; `a` needn't be normalized.
    private static func distance(_ a: [Float], _ unit: [Float]) -> Float {
        var dot: Float = 0, norm: Float = 0
        vDSP_dotpr(a, 1, unit, 1, &dot, vDSP_Length(min(a.count, unit.count)))
        vDSP_svesq(a, 1, &norm, vDSP_Length(a.count))
        return 1 - dot / max(norm.squareRoot(), 1e-9)
    }
}

/// Speaker embeddings from WeSpeaker (ResNet34, via FluidAudio): one per stretch of a
/// single voice.
actor VoiceEmbedder {
    static let shared = VoiceEmbedder()

    private var diarizer: DiarizerManager?
    private var loading: Task<DiarizerManager, Error>?

    var isReady: Bool { diarizer != nil }

    func prepare(folder: URL) async throws {
        if diarizer != nil { return }
        if let loading {
            diarizer = try await loading.value
            return
        }
        let task = Task {
            let models = try await DiarizerModels.downloadIfNeeded(to: folder)
            let manager = DiarizerManager()
            manager.initialize(models: models)
            return manager
        }
        loading = task
        do {
            diarizer = try await task.value
        } catch {
            loading = nil
            throw error
        }
    }

    func embedding(of samples: ArraySlice<Float>) -> [Float]? {
        guard let diarizer, samples.count >= 16000 * 3 / 10 else { return nil }
        let clip = Array(samples.suffix(160_000))
        guard let embedding = try? diarizer.extractSpeakerEmbedding(from: clip),
              embedding.contains(where: { $0 != 0 }) else { return nil }
        return embedding
    }
}

extension DiarizerManager: @retroactive @unchecked Sendable {}
