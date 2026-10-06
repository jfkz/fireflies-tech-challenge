import FluidAudio
import enum FluidAudio.Language
import Foundation


/// NVIDIA Parakeet TDT 0.6B v3 in moondream's "Ultra" post-training, run on the
/// Neural Engine by FluidAudio. 25 European languages, punctuation built in, and it
/// doesn't invent text for music or silence. One model shared by both channels,
/// used in turns.
actor ParakeetEngine {
    static let shared = ParakeetEngine()

    private var manager: AsrManager?
    private var loading: Task<AsrManager, Error>?
    private var listeners: [@Sendable (PipelineStatus) -> Void] = []
    private var busy = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    /// Its languages as (code, localized name), sorted by name.
    static let languages: [(code: String, name: String)] = Language.allCases
        .map { ($0.rawValue, Locale.current.localizedString(forLanguageCode: $0.rawValue) ?? $0.rawValue) }
        .sorted { $0.1.localizedStandardCompare($1.1) == .orderedAscending }

    var isReady: Bool { manager != nil }

    func prepare(onStatus: @escaping @Sendable (PipelineStatus) -> Void) async throws {
        if manager != nil { return }
        listeners.append(onStatus)
        let task: Task<AsrManager, Error>
        if let loading {
            task = loading
        } else {
            task = Task { try await Self.load { status in Task { await self.broadcast(status) } } }
            loading = task
        }
        do {
            manager = try await task.value
            loading = nil
            listeners.removeAll()
        } catch {
            loading = nil
            listeners.removeAll()
            throw error
        }
    }

    /// Transcribes up to 15 s of 16 kHz mono audio. `language` (an ISO code) only
    /// steers the alphabet; the model always detects the language itself.
    func transcribe(_ samples: [Float], language: String?) async throws -> String {
        await acquire()
        defer { release() }
        guard let manager else { return "" }
        var state = TdtDecoderState.make(decoderLayers: await manager.decoderLayerCount)
        let result = try await manager.transcribe(
            samples,
            decoderState: &state,
            language: language.flatMap(Language.init(rawValue:))
        )
        return TextCleaner.clean(result.text)
    }

    // MARK: - Private

    private func broadcast(_ status: PipelineStatus) {
        for listener in listeners { listener(status) }
    }

    private func acquire() async {
        if !busy {
            busy = true
            return
        }
        await withCheckedContinuation { waiters.append($0) }
    }

    private func release() {
        if waiters.isEmpty {
            busy = false
        } else {
            waiters.removeFirst().resume()
        }
    }

    private static func load(report: @escaping @Sendable (PipelineStatus) -> Void) async throws -> AsrManager {
        report(.loading("Downloading the speech model", fraction: 0))
        let models = try await AsrModels.downloadAndLoad(version: .ultra) { progress in
            switch progress.phase {
            case .listing:
                report(.loading("Downloading the speech model", fraction: 0))
            case .downloading:
                report(.loading("Downloading the speech model", fraction: progress.fractionCompleted))
            case .compiling:
                report(.loading("Preparing the speech model — the first time takes a minute or two"))
            }
        }
        let manager = AsrManager(config: .default)
        try await manager.loadModels(models)
        return manager
    }
}

struct ParakeetRecognizer: PhraseRecognizer {
    var name: String { "Parakeet" }
    // It doesn't need a second of speech to get the language right, unlike Whisper.
    var minimumPreview: Int { SpeechFormat.rate * 6 / 10 }

    func transcribe(_ samples: [Float], language: String?) async throws -> String {
        try await ParakeetEngine.shared.transcribe(samples, language: language)
    }
}

/// Removes non-speech markers and the stock phrases models invent for silence.
enum TextCleaner {
    private static let inventions = [
        "thank you for watching", "thanks for watching", "subscribe to", "amara.org",
        "субтитры", "продолжение следует", "подписывайтесь", "спасибо за просмотр",
        "untertitel", "sous-titres",
    ]

    static func clean(_ text: String) -> String {
        let result = text
            .replacingOccurrences(of: #"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪+|<unk>"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = result.lowercased()
        if inventions.contains(where: lower.contains) || result.allSatisfy({ $0.isPunctuation || $0.isWhitespace }) {
            return ""
        }
        return result
    }
}
