import AVFoundation
import BoringTalksKit
import Foundation

/// `BoringTalks --transcribe <file> [--speakers] [--mic <file>] [--language xx] [--realtime]`
///
/// Runs a file through the same pipeline as a meeting and prints the transcript
/// JSON the app would upload (`PUT /meetings/:id/transcript`) to stdout. Status
/// goes to stderr.
/// - `<file>` plays the part of system audio (the other people).
/// - `--speakers` tells the voices in it apart ("Speaker 1…N"); without it they
///   are all "Others".
/// - `--mic <file>` adds a second file as the microphone ("You").
/// - `--realtime` feeds the audio at the speed it plays, as a live meeting would
///   (previews and pitch cuts then behave exactly as live).
enum FileTranscriber {
    @MainActor
    private final class Collected {
        var records: [PhraseRecord] = []
    }

    struct Options {
        var system: URL
        var mic: URL?
        var speakers = false
        var language: String?
        var realtime = false

        init?(arguments: [String]) {
            func value(_ flag: String) -> String? {
                guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else { return nil }
                return arguments[index + 1]
            }
            guard let path = value("--transcribe") else { return nil }
            system = URL(fileURLWithPath: path)
            mic = value("--mic").map { URL(fileURLWithPath: $0) }
            speakers = arguments.contains("--speakers")
            language = value("--language")
            realtime = arguments.contains("--realtime")
        }
    }

    @MainActor
    static func run(_ options: Options, models: SpeechModels) async -> Int32 {
        func status(_ text: String) {
            FileHandle.standardError.write(Data("status: \(text)\n".utf8))
        }
        let progress = Task { @MainActor in
            var last = ""
            while !Task.isCancelled {
                if models.summary != last {
                    last = models.summary
                    status(last)
                }
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
        let ready = await models.prepare()
        progress.cancel()
        guard ready else {
            status("the speech model couldn't load: \(models.summary)")
            return 1
        }
        if options.speakers, !models.voicesReady {
            status("voice models unavailable; speakers won't be told apart")
        }

        let collected = Collected()
        var duration: TimeInterval = 0
        let started = Date()
        do {
            var inputs: [(AudioChannel, [[Float]])] = [(.system, try AudioFileReader.chunks(of: options.system))]
            if let mic = options.mic {
                inputs.append((.microphone, try AudioFileReader.chunks(of: mic)))
            }
            let registry = VoiceRegistry()
            var transcribers: [PhraseTranscriber] = []
            var feeds: [Task<Void, Never>] = []
            for (channel, chunks) in inputs {
                let voices = channel == .system && options.speakers && models.voicesReady ? registry : nil
                let transcriber = PhraseTranscriber(recognizer: ParakeetRecognizer(), language: options.language, voices: voices) { event in
                    guard event.isFinal, !event.text.isEmpty else { return }
                    collected.records.append(PhraseRecord(channel: channel, voice: event.speaker?.voice,
                                                startMs: event.start * 1000 / SpeechFormat.rate,
                                                endMs: event.end * 1000 / SpeechFormat.rate, text: event.text))
                }
                transcribers.append(transcriber)
                duration = max(duration, Double(chunks.reduce(0) { $0 + $1.count }) / Double(SpeechFormat.rate))
                let realtime = options.realtime
                feeds.append(Task.detached {
                    for chunk in chunks {
                        transcriber.feed(chunk)
                        if realtime { try? await Task.sleep(for: .seconds(Double(chunk.count) / Double(SpeechFormat.rate))) }
                    }
                })
            }
            for feed in feeds { await feed.value }
            for transcriber in transcribers { await transcriber.finish() }
        } catch {
            status("couldn't read the audio: \(error.localizedDescription)")
            return 1
        }

        let segments = SegmentAssembler.assemble(collected.records)
        let language = options.language ?? LanguageGuess.detect(segments.map(\.text).joined(separator: " "))
        let upload = TranscriptUpload(language: language, durationSec: Int(duration.rounded()), segments: segments)
        let encoder = APICoding.encoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(upload) else { return 1 }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
        status(String(format: "%d segments, %d speakers, %.1f s of audio in %.1f s", segments.count,
                      Set(segments.map(\.speaker)).count, duration, Date().timeIntervalSince(started)))
        return 0
    }
}
