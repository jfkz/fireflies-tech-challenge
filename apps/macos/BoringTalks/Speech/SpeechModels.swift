import BoringTalksKit
import Foundation
import Observation

/// Downloads and loads the on-device models once per launch: Parakeet (~630 MB,
/// shared with other FluidAudio apps in ~/Library/Application Support/FluidAudio)
/// and the voice models (~45 MB, in Application Support/BoringTalks/models).
@MainActor @Observable
final class SpeechModels {
    enum State: Equatable {
        case idle
        case loading(title: String, fraction: Double?)
        case ready
        case failed(String)
    }

    private(set) var state: State = .idle
    /// Voices can be told apart (the speech model works without them).
    private(set) var voicesReady = false
    @ObservationIgnored private var task: Task<Bool, Never>?
    @ObservationIgnored private let folders: AppFolders
    private static let log = Log.logger("models")

    init(folders: AppFolders) {
        self.folders = folders
    }

    var isReady: Bool { state == .ready }

    var summary: String {
        switch state {
        case .idle: "Not loaded"
        case .loading(let title, let fraction): fraction.map { "\(title)… \(Int($0 * 100))%" } ?? "\(title)…"
        case .ready: voicesReady ? "Ready · Parakeet v3 + voice separation" : "Ready · Parakeet v3 (voices not separated)"
        case .failed(let message): "Failed: \(message)"
        }
    }

    /// Starts loading (once) and returns whether the speech model is ready.
    @discardableResult
    func prepare() async -> Bool {
        if let task { return await task.value }
        let task = Task { await load() }
        self.task = task
        let ready = await task.value
        if !ready { self.task = nil }
        return ready
    }

    private func load() async -> Bool {
        state = .loading(title: "Downloading the speech model", fraction: 0)
        do {
            try await ParakeetEngine.shared.prepare { status in
                Task { @MainActor [weak self] in
                    guard let self, case .loading = self.state, let loading = status.loading else { return }
                    self.state = .loading(title: loading.title, fraction: loading.fraction)
                }
            }
        } catch {
            Self.log.error("speech model failed: \(error.localizedDescription, privacy: .public)")
            state = .failed(error.localizedDescription)
            return false
        }
        state = .loading(title: "Loading the voice models", fraction: nil)
        do {
            try folders.create()
            try await VoiceIdentifier.shared.prepare(folder: folders.models)
            try await VoiceEmbedder.shared.prepare(folder: folders.models.appendingPathComponent("diarizer", isDirectory: true))
            voicesReady = true
        } catch {
            // Still transcribe, just without telling the other people apart.
            Self.log.notice("voice models unavailable: \(error.localizedDescription, privacy: .public)")
        }
        state = .ready
        Self.log.notice("models ready (voices: \(self.voicesReady, privacy: .public))")
        return true
    }
}
