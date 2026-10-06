import Accelerate
import AVFoundation
import BoringTalksKit
import os

// With the time of every phrase kept: a meeting transcript
// needs to know when each phrase was said, not only what and by whom.

/// A speech model that transcribes a whole phrase at a time.
protocol PhraseRecognizer: Sendable {
    var name: String { get }
    /// Shortest phrase (in 16 kHz samples) worth a preview.
    var minimumPreview: Int { get }
    /// `language` is an ISO code, or nil to detect it.
    func transcribe(_ samples: [Float], language: String?) async throws -> String
}

/// Text from the transcriber: a preview of the phrase still being spoken, or a
/// finished phrase (one per speaker turn).
struct PhraseEvent: Sendable {
    var text: String
    var isFinal: Bool
    /// Set when voices are told apart (system audio).
    var speaker: SpeakerTag?
    var phrase: Int
    /// Sample positions (16 kHz) in the stream fed to the transcriber.
    var start: Int
    var end: Int
}

/// Parakeet isn't a streaming model, so this listens like a person reading along:
/// it keeps the audio of the current phrase, re-transcribes it as it grows (a
/// preview) and finalizes it at a pause, or every 15 s of non-stop sound.
///
/// With a `VoiceRegistry` it also tells speakers apart: a phrase is cut where the
/// pitch jumps or the voice embedding changes, split into turns by SpeakerKit
/// when it ends, and each turn is matched to a known voice.
final class PhraseTranscriber: @unchecked Sendable {
    typealias EventHandler = @MainActor @Sendable (PhraseEvent) -> Void

    private let recognizer: any PhraseRecognizer
    private let language: String?
    private let onEvent: EventHandler
    /// Recognizes the voices of a phrase; nil when speakers aren't told apart.
    private let voices: VoiceRegistry?

    private struct Finished {
        /// Position of `samples[0]` in the stream.
        var start: Int
        var samples: [Float]
        /// Quiet lead-in before the first word, not part of the phrase's time.
        var leadIn: Int
    }

    private struct Phrase {
        /// The phrase being spoken.
        var samples: [Float] = []
        /// Position of `samples[0]` in the stream.
        var start = 0
        /// Index in `samples` where speech began.
        var firstVoice: Int?
        /// Samples of it that sounded like speech.
        var voiced = 0
        /// Index just after the last speech-like chunk.
        var voiceEnd = 0
        var noiseFloor: Float = -60
        /// Phrases that ended, waiting for their final transcription. Cut here as the
        /// audio arrives, so a busy transcriber can't merge two speakers.
        var finished: [Finished] = []
        var finishing = false

        mutating func finishPhrase(rate: Int) {
            if voiced >= rate / 4 {
                // Keep 0.3 s after the last word; trailing silence invites made-up words.
                let end = min(samples.count, voiceEnd + rate * 3 / 10)
                finished.append(Finished(start: start, samples: Array(samples[0..<end]),
                                         leadIn: min(end, max(0, (firstVoice ?? 0) - rate / 10))))
            }
            start += samples.count
            samples.removeAll(keepingCapacity: true)
            voiced = 0
            voiceEnd = 0
            firstVoice = nil
        }

        /// Another voice took over at `cut`: what came before is a phrase of its own.
        mutating func cut(at cut: Int, rate: Int) {
            guard samples.count > cut else { return }
            finished.append(Finished(start: start, samples: Array(samples[0..<cut]),
                                     leadIn: min(cut, max(0, (firstVoice ?? 0) - rate / 10))))
            samples.removeFirst(cut)
            start += cut
            voiceEnd = max(0, voiceEnd - cut)
            voiced = max(rate / 4, voiced - cut)
            firstVoice = 0
        }
    }

    private let phrase = OSAllocatedUnfairLock(initialState: Phrase())
    /// Silence that ends a phrase. Telling speakers apart works per phrase, so it's
    /// shorter when they are told apart.
    private var pause: Int { voices == nil ? Self.rate * 8 / 10 : Self.rate * 6 / 10 }
    private var loop: Task<Void, Never>?
    /// Finished phrases, transcribed and told apart one after another while the
    /// next phrase is already being previewed.
    private var finals: Task<Void, Never>?

    private static let rate = SpeechFormat.rate
    /// `BT_TRACE=1`: prints to stderr how voices are told apart.
    static let trace = ProcessInfo.processInfo.environment["BT_TRACE"] != nil
    private static let log = Log.logger("phrases")

    init(recognizer: any PhraseRecognizer, language: String?, voices: VoiceRegistry?, onEvent: @escaping EventHandler) {
        self.recognizer = recognizer
        self.language = language
        self.onEvent = onEvent
        self.voices = voices
        loop = Task { [weak self] in await self?.run() }
    }

    /// 16 kHz mono samples, in order, without gaps (silence included).
    func feed(_ chunk: [Float]) {
        guard !chunk.isEmpty else { return }
        var rms: Float = 0
        vDSP_rmsqv(chunk, 1, &rms, vDSP_Length(chunk.count))
        let db = 20 * log10(max(rms, 1e-7))
        let pause = pause
        phrase.withLock { p in
            let offset = p.samples.count
            p.samples.append(contentsOf: chunk)
            p.noiseFloor = db < p.noiseFloor ? db : min(p.noiseFloor + 0.05, db)
            if db > max(p.noiseFloor + 10, -52) {
                p.voiced += chunk.count
                p.voiceEnd = p.samples.count
                if p.firstVoice == nil { p.firstVoice = offset }
            }
            if p.voiced == 0 {
                // Nothing said yet: keep only half a second of lead-in.
                if p.samples.count > Self.rate {
                    let drop = p.samples.count - Self.rate / 2
                    p.samples.removeFirst(drop)
                    p.start += drop
                }
            } else if p.samples.count - p.voiceEnd > pause || p.samples.count > Self.rate * 15 {
                p.finishPhrase(rate: Self.rate)
            }
        }
    }

    func stop() {
        loop?.cancel()
        finals?.cancel()
    }

    /// Ends the input and waits for the last phrases to be transcribed.
    func finish() async {
        phrase.withLock { $0.finishing = true }
        await loop?.value
        await finals?.value
    }

    // MARK: - Live loop

    /// Who speaks in the phrase being previewed, worked out next to the transcription
    /// so it never holds the text up.
    private struct Identification {
        /// Counts phrases, so a late answer about an earlier phrase is ignored.
        var phrase = 0
        /// Where the person speaking now started in the phrase, and who it is.
        var turn: (start: Int, tag: SpeakerTag)?
        var checkedAt = 0
        var running = false
        /// The latest preview, sent again when it turns out to be someone else's.
        var shown: PhraseEvent?
        /// The voice the phrase started with, to notice when someone else takes over.
        var reference: [Float]?
        var watchedTo = 0
        var watching = false
        /// Where the voice first seemed to change, waiting for a second look.
        var suspect: Int?
        /// Where another voice took over; the phrase is cut there.
        var cut: Int?
    }
    private let identification = OSAllocatedUnfairLock(initialState: Identification())

    /// Pitch of each 0.4 s of the current phrase (nil where nobody speaks).
    private struct PitchTrack {
        static let window = 16000 * 4 / 10
        var pitches: [Float?] = []
        var turnStart = 0

        var analyzed: Int { pitches.count * Self.window }

        mutating func extend(with phrase: [Float]) {
            while analyzed + Self.window <= phrase.count {
                pitches.append(Pitch.median(phrase[analyzed..<(analyzed + Self.window)]))
            }
        }

        /// Pitch of the words said lately; nil before 1.2 s of speech.
        var recent: Float? {
            let voiced = pitches[turnStart...].suffix(4).compactMap { $0 }
            return voiced.count >= 3 ? Self.median(voiced) : nil
        }

        /// Where another voice took over, judged by pitch alone: the last 0.8 s of
        /// speech sits more than 6 semitones away from the 1.2 s or more before it.
        /// Intonation moves a voice about 3–4 semitones; a man and a woman are about
        /// 10 apart.
        mutating func change() -> Int? {
            let voiced = pitches.indices.filter { $0 >= turnStart && pitches[$0] != nil }
            guard voiced.count >= 5 else { return nil }
            let recent = voiced.suffix(2), before = voiced.dropLast(2)
            guard let base = Self.median(before.compactMap { pitches[$0] }) else { return nil }
            let jumps = recent.compactMap { pitches[$0] }.map { abs(12 * log2($0 / base)) }
            guard jumps.count == recent.count, jumps.allSatisfy({ $0 > 6 }), let first = recent.first else { return nil }
            return first * Self.window
        }

        private static func median(_ values: [Float]) -> Float? {
            values.isEmpty ? nil : values.sorted()[values.count / 2]
        }
    }

    private func run() async {
        var previewedUpTo = 0
        var track = PitchTrack()
        while !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(150))
            let (finished, current, finishing, start, firstVoice) = phrase.withLock { p in
                if p.finishing { p.finishPhrase(rate: Self.rate) }
                defer { p.finished.removeAll() }
                return (p.finished, p.samples, p.finishing, p.start, p.firstVoice)
            }
            for piece in finished {
                let number = identification.withLock { state in
                    defer { state = Identification(phrase: state.phrase + 1) }
                    return state.phrase
                }
                if voices == nil {
                    await finish(piece, phrase: number)
                } else {
                    // Telling speakers apart takes a moment; don't hold up the
                    // next phrase's words for it.
                    let previous = finals
                    finals = Task {
                        await previous?.value
                        await self.finish(piece, phrase: number)
                    }
                }
                if Task.isCancelled { return }
                previewedUpTo = 0
                track = PitchTrack()
            }
            if finishing { return }

            // Preview the phrase in progress as soon as the recognizer can.
            let voiced = phrase.withLock { $0.voiced }
            if previewedUpTo > current.count {
                previewedUpTo = 0
                identification.withLock { $0 = Identification(phrase: $0.phrase + 1) }
            }
            if voices != nil {
                if voiced == 0 || track.analyzed > current.count { track = PitchTrack() }
                track.extend(with: current)
                // The pitch jumped: someone else speaks. Their words start a phrase of
                // their own right away; who it is gets sorted out after.
                if let cut = track.change() {
                    phrase.withLock { $0.cut(at: cut, rate: Self.rate) }
                    if Self.trace { Self.traceLine(String(format: "cut by pitch at %.1f s", Double(start + cut) / 16000)) }
                    continue
                }
                // The same for a change the voice embedding noticed (two people of
                // about the same pitch).
                if let cut = identification.withLock({ state -> Int? in
                    defer { state.cut = nil }
                    return state.cut
                }), cut < current.count {
                    phrase.withLock { $0.cut(at: cut, rate: Self.rate) }
                    if Self.trace { Self.traceLine(String(format: "cut by voice at %.1f s", Double(start + cut) / 16000)) }
                    continue
                }
                watchForAnotherVoice(current)
            }
            guard voiced >= Self.rate / 4, current.count >= recognizer.minimumPreview,
                  current.count - previewedUpTo >= Self.rate * 4 / 10 else { continue }

            identifyInBackground(current, start: start)
            var audio = current
            var tag: SpeakerTag?
            var from = firstVoice ?? 0
            let state = identification.withLock { $0 }
            if voices != nil {
                // Until the voice is known the words go to whoever is most likely
                // talking, and move once it is.
                tag = state.turn?.tag ?? SpeakerTag(voice: nil)
                tag?.phrase = state.phrase
                tag?.pitch = track.recent
                // Only the words of whoever is speaking now.
                if let turn = state.turn {
                    audio = Array(current[min(turn.start, current.count)...])
                    from = turn.start
                }
            }
            let text = await transcribe(audio)
            if Task.isCancelled { return }
            previewedUpTo = current.count
            // The phrase may have ended meanwhile; its final text is on the way.
            let stillCurrent = phrase.withLock { $0.finished.isEmpty && $0.samples.count >= current.count && $0.start == start }
            if stillCurrent, !text.isEmpty {
                let event = PhraseEvent(text: text, isFinal: false, speaker: tag, phrase: state.phrase,
                                        start: start + from, end: start + current.count)
                identification.withLock { if $0.phrase == state.phrase { $0.shown = event } }
                await onEvent(event)
            }
        }
    }

    /// Finds who is speaking now, first after a second of the phrase and then every
    /// two seconds, without waiting for it; re-sends the preview if it turns out to
    /// be someone else's.
    private func identifyInBackground(_ current: [Float], start: Int) {
        guard let voices else { return }
        let number: Int? = identification.withLock { state in
            guard !state.running, current.count >= Self.rate,
                  state.turn == nil || current.count - state.checkedAt >= Self.rate * 2 else { return nil }
            state.running = true
            state.checkedAt = current.count
            return state.phrase
        }
        guard let number else { return }
        Task {
            let turns = await VoiceIdentifier.shared.turns(in: current)
            let found: (start: Int, tag: SpeakerTag)?
            if let last = turns.last {
                let sample = await Self.sample(current[last.range])
                found = (last.range.lowerBound, sample.map { voices.match($0) } ?? SpeakerTag(voice: nil))
            } else {
                found = nil
            }
            let resend: PhraseEvent? = identification.withLock { state in
                guard state.phrase == number else { return nil }
                state.running = false
                guard let found else { return nil }
                state.turn = found
                guard var shown = state.shown else { return nil }
                // Known now, or plainly someone new: move the words there.
                let moved = found.tag.voice != nil ? shown.speaker?.voice != found.tag.voice
                    : found.tag.unfamiliar && !(shown.speaker?.unfamiliar ?? false)
                guard moved else { return nil }
                var tag = found.tag
                tag.phrase = number
                shown.speaker = tag
                state.shown = shown
                return shown
            }
            if let resend {
                await onEvent(resend)
            }
        }
    }

    /// Compares the last 1.5 s of the phrase with how it began, every half second,
    /// and marks where another voice took over: one clear difference, or two likely
    /// ones in a row.
    private func watchForAnotherVoice(_ current: [Float]) {
        let window = Self.rate * 3 / 2
        enum Job { case reference(Int), compare(Int, [Float]) }
        let job: Job? = identification.withLock { state in
            guard !state.watching else { return nil }
            if state.reference == nil {
                guard current.count >= Self.rate * 5 / 2 else { return nil }
                state.watching = true
                return .reference(state.phrase)
            }
            guard current.count - state.watchedTo >= Self.rate / 2, current.count >= Self.rate * 4,
                  let reference = state.reference else { return nil }
            state.watching = true
            state.watchedTo = current.count
            return .compare(state.phrase, reference)
        }
        guard let job else { return }
        Task {
            switch job {
            case .reference(let number):
                // The first two seconds of speech (after the lead-in).
                let embedding = await VoiceEmbedder.shared.embedding(of: current[(Self.rate / 2)..<(Self.rate * 5 / 2)])
                identification.withLock { state in
                    guard state.phrase == number else { return }
                    state.watching = false
                    state.reference = embedding
                    state.watchedTo = current.count
                }
            case .compare(let number, let reference):
                let start = current.count - window
                let embedding = await VoiceEmbedder.shared.embedding(of: current[start...])
                let distance = embedding.map { VoiceRegistry.distance(between: reference, and: $0) } ?? 0
                identification.withLock { state in
                    guard state.phrase == number else { return }
                    state.watching = false
                    // The change is most likely in the middle of the window.
                    let here = start + window / 3
                    // One person against the start of their own phrase: 0.51 typical,
                    // 0.69 at the 90th percentile; a change of speaker: 0.85–0.95.
                    if distance > 0.82 || distance > 0.72 && state.suspect != nil {
                        state.cut = state.suspect ?? here
                    } else {
                        state.suspect = distance > 0.72 ? here : nil
                    }
                }
                if Self.trace { Self.traceLine(String(format: "watch %.3f at %.1f s of the phrase", distance, Double(current.count) / 16000)) }
            }
        }
    }

    // MARK: - Finished phrases

    /// A finished phrase: split at speaker changes, each turn to its speaker.
    private func finish(_ piece: Finished, phrase number: Int) async {
        guard let voices else {
            let text = await transcribe(piece.samples)
            await onEvent(PhraseEvent(text: text, isFinal: true, speaker: nil, phrase: number,
                                      start: piece.start + piece.leadIn, end: piece.start + piece.samples.count))
            return
        }
        let turns = await VoiceIdentifier.shared.turns(in: piece.samples)
        for (index, turn) in turns.enumerated() {
            let part = Array(piece.samples[turn.range])
            let text = await transcribe(part)
            // An unrecognized voice becomes a new speaker rather than a guess.
            let sample = await Self.sample(part[...])
            var tag = sample.map { voices.identify($0) } ?? SpeakerTag(voice: nil)
            tag.phrase = number
            let lower = index == 0 ? min(max(turn.range.lowerBound, piece.leadIn), turn.range.upperBound) : turn.range.lowerBound
            if Self.trace {
                Self.traceLine(String(format: "final %.1f–%.1f s voice %@: %@", Double(piece.start + lower) / 16000,
                                      Double(piece.start + turn.range.upperBound) / 16000, tag.voice.map(String.init) ?? "?", text))
            }
            await onEvent(PhraseEvent(text: text, isFinal: true, speaker: tag, phrase: number,
                                      start: piece.start + lower, end: piece.start + turn.range.upperBound))
        }
    }

    /// Who is speaking in a stretch of audio and how their voice sounds.
    private static func sample(_ audio: ArraySlice<Float>) async -> VoiceSample? {
        guard let embedding = await VoiceEmbedder.shared.embedding(of: audio) else { return nil }
        return VoiceSample(embedding: embedding, traits: VoiceTraits.measure(audio))
    }

    private func transcribe(_ audio: [Float]) async -> String {
        do {
            return try await recognizer.transcribe(audio, language: language)
        } catch {
            Self.log.notice("transcription failed: \(error.localizedDescription, privacy: .public)")
            return ""
        }
    }

    private static func traceLine(_ text: String) {
        FileHandle.standardError.write(Data("TRACE \(text)\n".utf8))
    }
}
