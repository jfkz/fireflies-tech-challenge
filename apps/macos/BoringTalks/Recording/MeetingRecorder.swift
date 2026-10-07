import AVFoundation
import BoringTalksKit
import Observation

/// Records one meeting: the microphone is "You", what the Mac plays is everyone
/// else. Both channels run on one clock (seconds since Start), go to their own
/// transcriber, and are mixed into one AAC file. Stop hands back a
/// `PendingMeeting` for the upload queue.
@MainActor @Observable
final class MeetingRecorder {
    enum Phase: Equatable {
        case idle, starting, recording, finishing
    }

    private(set) var phase: Phase = .idle
    private(set) var startedAt: Date?
    /// Problems with one side ("System audio permission is off…").
    private(set) var warnings: [AudioChannel: String] = [:]
    /// Recording while the speech model is still loading; audio waits for it.
    private(set) var waitingForModel = false
    /// The microphone recording "You" (shown in the menu).
    private(set) var microphoneName: String?
    /// See `Preferences.avoidBluetoothMic`; read when a meeting starts.
    @ObservationIgnored var avoidBluetoothMic = true
    /// Quiet this long (seconds) stops the meeting; 0 never does. Read when a meeting starts.
    @ObservationIgnored var silenceLimit: TimeInterval = 300
    /// Nobody has spoken for a while: the recording stops at this moment unless someone keeps it going.
    private(set) var silenceStopsAt: Date?
    /// The quiet began to count down (once per quiet spell), with the seconds left;
    /// nil when someone spoke again before the stop.
    @ObservationIgnored var onSilenceWarning: (@MainActor (TimeInterval?) -> Void)?
    /// The quiet reached the limit (seconds). The owner stops the meeting.
    @ObservationIgnored var onSilence: (@MainActor (TimeInterval) -> Void)?
    let live = LiveTranscript()

    @ObservationIgnored private let models: SpeechModels
    @ObservationIgnored private let folders: AppFolders
    @ObservationIgnored private var channels: [AudioChannel: RecordingChannel] = [:]
    @ObservationIgnored private var mic: MicCapture?
    @ObservationIgnored private var system: SystemAudioCapture?
    @ObservationIgnored private var writer: RecordingWriter?
    @ObservationIgnored private var registry = VoiceRegistry()
    @ObservationIgnored private var records: [PhraseRecord] = []
    @ObservationIgnored private var meeting: (id: UUID, title: String?, language: String?, uploadAudio: Bool)?
    @ObservationIgnored private var clockStart: TimeInterval = 0
    @ObservationIgnored private var ticker: Task<Void, Never>?
    @ObservationIgnored private var modelWait: Task<Void, Never>?
    @ObservationIgnored private var restarts: [AudioChannel: Task<Void, Never>] = [:]
    /// System audio still starting (macOS may be waiting for its permission prompt).
    @ObservationIgnored private var systemStart: Task<Void, Never>?
    /// Channels that have (or are getting) a transcriber.
    @ObservationIgnored private var attached: Set<AudioChannel> = []
    @ObservationIgnored private var attaching: Task<Void, Never>?
    @ObservationIgnored private var silence = SilenceWatch(limit: 0)
    /// Meeting-clock seconds when the transcript last heard someone.
    @ObservationIgnored private var lastSpeech: TimeInterval = 0
    @ObservationIgnored private var silenceReported = false
    /// Meters for the menu while nothing records.
    @ObservationIgnored private let idleMeters: [AudioChannel: LevelMeter] = [.microphone: LevelMeter(), .system: LevelMeter()]
    private static let log = Log.logger("recorder")

    init(models: SpeechModels, folders: AppFolders) {
        self.models = models
        self.folders = folders
    }

    func meter(_ channel: AudioChannel) -> LevelMeter {
        channels[channel]?.meter ?? idleMeters[channel] ?? LevelMeter()
    }

    var isRecording: Bool { phase == .recording }

    /// The file being recorded now, which the janitor must leave alone.
    var currentFileName: String? { meeting.map { "\($0.id.uuidString).m4a" } }

    enum StartError: LocalizedError {
        case nothingToRecord(String)

        var errorDescription: String? {
            switch self {
            case .nothingToRecord(let reason): "Couldn't record: \(reason)"
            }
        }
    }

    func start(title: String?, language: String?, uploadAudio: Bool) async throws {
        guard phase == .idle else { return }
        phase = .starting
        warnings = [:]
        records = []
        live.reset()
        registry = VoiceRegistry()
        silence = SilenceWatch(limit: silenceLimit)
        lastSpeech = 0
        silenceReported = false
        silenceStopsAt = nil
        let id = UUID()
        let trimmedTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines)
        meeting = (id, trimmedTitle?.isEmpty == false ? trimmedTitle : nil, language, uploadAudio)

        do {
            try folders.create()
            let writer = try RecordingWriter(url: folders.recordings.appendingPathComponent("\(id.uuidString).m4a"))
            self.writer = writer
            clockStart = ProcessInfo.processInfo.systemUptime
            startedAt = Date()
            for kind in AudioChannel.allCases {
                channels[kind] = RecordingChannel(kind: kind, clockStart: clockStart, writer: writer)
            }

            // Keep both sides on the clock from the first moment: a side that is slow
            // to start (or never does) is filled with silence instead of stalling the mix.
            ticker = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(500))
                    self?.channels.values.forEach { $0.catchUp() }
                    self?.checkSilence()
                }
            }
            let micStarted = await startMic()
            // Core Audio blocks system-audio capture until the System Audio Recording
            // prompt is answered. Don't hold the meeting hostage to it: record the mic
            // now and let the other side join when it can.
            let system = Task { await self.startSystem() }
            systemStart = Task { _ = await system.value }
            let systemStarted = await Self.result(of: system, within: micStarted ? .seconds(3) : .seconds(60))
            if systemStarted == nil {
                warnings[.system] = "Waiting for macOS to allow System Audio Recording. Answer its prompt, or allow BoringTalks under System Settings › Privacy & Security › Screen & System Audio Recording."
            }
            guard micStarted || systemStarted == true else {
                throw StartError.nothingToRecord(warnings.values.sorted().joined(separator: " "))
            }
        } catch {
            await abandon()
            throw error
        }

        phase = .recording
        Self.log.notice("recording \(id, privacy: .public)")
        // Transcribe as soon as the model is there; until then the audio waits.
        waitingForModel = !models.isReady
        modelWait = Task { [weak self] in
            guard let self, await self.models.prepare(), !Task.isCancelled, self.phase == .recording else { return }
            await self.attachTranscribers(to: Array(self.channels.keys))
        }
    }

    /// Stops and returns the meeting to upload (nil if nothing was recorded).
    func stop() async -> PendingMeeting? {
        guard phase == .recording, let meeting, let writer, let startedAt else { return nil }
        phase = .finishing
        systemStart?.cancel()
        ticker?.cancel()
        modelWait?.cancel()
        restarts.values.forEach { $0.cancel() }
        mic?.stop()
        system?.stop()
        mic = nil
        system = nil
        let elapsed = ProcessInfo.processInfo.systemUptime - clockStart
        // A model that has just arrived may be attaching right now.
        await attaching?.value

        var endings: [AudioChannel: RecordingChannel.Ending] = [:]
        for (kind, channel) in channels {
            endings[kind] = await channel.end(at: elapsed)
        }
        // The model may have finished loading just now.
        let missing = endings.keys.filter { !attached.contains($0) }
        if models.isReady, !missing.isEmpty {
            await attachTranscribers(to: missing)
            for kind in missing {
                if let channel = channels[kind] { endings[kind] = await channel.end(at: elapsed) }
            }
        }
        for ending in endings.values {
            await ending.transcriber?.finish()
        }
        let seconds = await writer.finish()

        // Sides that couldn't start count as heard (there is nothing to transcribe).
        let transcribed = endings.allSatisfy { kind, ending in ending.transcribed || warnings[kind] != nil }
        let segments = transcribed ? SegmentAssembler.assemble(records) : []
        if !transcribed {
            Self.log.notice("no local transcript; the server will transcribe the audio")
        }
        let language = meeting.language ?? LanguageGuess.detect(segments.map(\.text).joined(separator: " "))
        let fileName = seconds > 0.5 ? writer.url.lastPathComponent : nil
        if fileName == nil { try? FileManager.default.removeItem(at: writer.url) }

        let pending = PendingMeeting(id: meeting.id, title: meeting.title, startedAt: startedAt,
                                     durationSec: Int(elapsed.rounded()), language: language, segments: segments,
                                     audioFileName: fileName, uploadAudio: meeting.uploadAudio)
        reset()
        Self.log.notice("stopped: \(segments.count, privacy: .public) segments, \(Int(elapsed), privacy: .public) s")
        return pending.hasContent(audioExists: fileName != nil) ? pending : nil
    }

    // MARK: - Capture

    private func startMic() async -> Bool {
        guard await MicCapture.requestAccess() else {
            fail(.microphone, CaptureError.microphoneDenied.localizedDescription)
            return false
        }
        guard let channel = channels[.microphone] else { return false }
        let capture = MicCapture()
        capture.onConfigurationChange = { [weak self] in
            Task { @MainActor in self?.scheduleRestart(.microphone) }
        }
        let defaultInput = AudioInputs.defaultInput()
        let chosen = MicChoice.pick(defaultInput: defaultInput, inputs: AudioInputs.all(), avoidBluetooth: avoidBluetoothMic)
        do {
            try capture.start(device: chosen.map { AudioDeviceID($0.id) }) { buffer in channel.ingest(buffer) }
            microphoneName = (chosen ?? defaultInput)?.name
            if let chosen { Self.log.notice("recording You with \(chosen.name, privacy: .public) instead of a Bluetooth headset") }
            mic = capture
            warnings[.microphone] = nil
            return true
        } catch {
            fail(.microphone, error.localizedDescription)
            return false
        }
    }

    /// The task's result, or nil when it isn't done within `limit` (it keeps running).
    private static func result(of task: Task<Bool, Never>, within limit: Duration) async -> Bool? {
        await withTaskGroup(of: Bool?.self) { group in
            group.addTask { await task.value }
            group.addTask {
                try? await Task.sleep(for: limit)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    private func startSystem() async -> Bool {
        guard let channel = channels[.system] else { return false }
        let generation = meeting?.id
        let capture = SystemAudioCapture()
        capture.onDeviceChange = { [weak self] in
            Task { @MainActor in self?.scheduleRestart(.system) }
        }
        do {
            // Core Audio blocks this call until the System Audio Recording prompt
            // is answered, so keep it off the main thread.
            try await Task.detached { try capture.start { buffer in channel.ingest(buffer) } }.value
            // The meeting may have ended while macOS was asking for permission.
            guard meeting?.id == generation, phase == .starting || phase == .recording else {
                capture.stop()
                return false
            }
            system = capture
            warnings[.system] = nil
            return true
        } catch {
            fail(.system, "System audio: \(error.localizedDescription). Allow BoringTalks under System Settings › Privacy & Security › Screen & System Audio Recording.")
            return false
        }
    }

    private func fail(_ channel: AudioChannel, _ message: String) {
        warnings[channel] = message
        writer?.remove(channel)
        // A side that never started has nothing to transcribe. (One that fails on a
        // device change keeps its channel, so what it heard is still transcribed.)
        if phase == .starting { channels[channel] = nil }
        Self.log.error("\(channel.rawValue, privacy: .public): \(message, privacy: .public)")
    }

    /// Device changes arrive in bursts; restart that capture once they settle.
    /// The timeline fills the gap with silence.
    private func scheduleRestart(_ kind: AudioChannel) {
        guard phase == .recording else { return }
        restarts[kind]?.cancel()
        restarts[kind] = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard let self, !Task.isCancelled, self.phase == .recording else { return }
            Self.log.notice("audio device changed; restarting \(kind.rawValue, privacy: .public)")
            switch kind {
            case .microphone:
                self.mic?.stop()
                self.mic = nil
                _ = await self.startMic()
            case .system:
                self.system?.stop()
                self.system = nil
                _ = await self.startSystem()
            }
        }
    }

    // MARK: - Transcription

    /// Gives each channel in `kinds` that has none yet its transcriber (fed its
    /// backlog first). Marked before any suspension, so Stop pressed while the model
    /// arrives can never attach a second one.
    private func attachTranscribers(to kinds: [AudioChannel]) async {
        waitingForModel = false
        let pending = kinds.filter { !attached.contains($0) }
        // Until now the meters said when someone was heard; the transcriber starts on the
        // backlog, so carry that over rather than count the wait as quiet.
        lastSpeech = max(lastSpeech, meterActivity(of: pending))
        attached.formUnion(pending)
        let language = meeting?.language
        let previous = attaching
        let task = Task { @MainActor [weak self] in
            await previous?.value
            for kind in pending {
                guard let self, let channel = self.channels[kind] else { continue }
                let voices = kind == .system && self.models.voicesReady ? self.registry : nil
                let transcriber = PhraseTranscriber(recognizer: ParakeetRecognizer(), language: language, voices: voices) { [weak self] event in
                    self?.receive(event, from: kind)
                }
                await channel.attach(transcriber)
            }
        }
        attaching = task
        await task.value
    }

    private func receive(_ event: PhraseEvent, from channel: AudioChannel) {
        let startMs = event.start * 1000 / SpeechFormat.rate
        let endMs = event.end * 1000 / SpeechFormat.rate
        live.receive(text: event.text, isFinal: event.isFinal, channel: channel, voice: event.speaker?.voice, startMs: startMs)
        if !event.text.isEmpty {
            lastSpeech = max(lastSpeech, Double(event.end) / Double(SpeechFormat.rate))
        }
        guard event.isFinal, !event.text.isEmpty else { return }
        records.append(PhraseRecord(channel: channel, voice: event.speaker?.voice, startMs: startMs, endMs: endMs, text: event.text))
    }

    // MARK: - Silence

    /// Someone is still there: the quiet starts counting again from now.
    func keepRecording() {
        guard phase == .recording else { return }
        silence.keepRecording(at: ProcessInfo.processInfo.systemUptime - clockStart)
        silenceStopsAt = nil
    }

    /// Called every half second while recording.
    private func checkSilence() {
        guard phase == .recording, silence.isOn, !silenceReported else { return }
        let now = ProcessInfo.processInfo.systemUptime - clockStart
        let unheard = channels.keys.filter { !attached.contains($0) }
        let lastActivity = max(lastSpeech, meterActivity(of: unheard))
        switch silence.verdict(lastActivity: lastActivity, now: now) {
        case .listening:
            guard silenceStopsAt != nil else { return }
            silenceStopsAt = nil
            onSilenceWarning?(nil)
        case .warning(let left):
            guard silenceStopsAt == nil else { return }
            silenceStopsAt = Date().addingTimeInterval(left)
            Self.log.notice("quiet for \(Int(self.silence.quiet(lastActivity: lastActivity, now: now)), privacy: .public) s; stopping in \(Int(left), privacy: .public) s")
            onSilenceWarning?(left)
        case .stop:
            silenceReported = true
            silenceStopsAt = nil
            Self.log.notice("quiet for \(Int(self.silence.limit), privacy: .public) s; stopping the meeting")
            onSilence?(silence.limit)
        }
    }

    /// When the meters of channels without a transcriber last heard a sound
    /// (meeting clock). Their words aren't known yet, so any clear sound counts.
    private func meterActivity(of kinds: [AudioChannel]) -> TimeInterval {
        let now = ProcessInfo.processInfo.systemUptime - clockStart
        return kinds.compactMap { channels[$0] }.map { now - $0.meter.snapshot().sinceSound }.max() ?? 0
    }

    // MARK: - Teardown

    private func abandon() async {
        mic?.stop()
        system?.stop()
        if let writer {
            _ = await writer.finish()
            try? FileManager.default.removeItem(at: writer.url)
        }
        reset()
    }

    private func reset() {
        systemStart?.cancel()
        systemStart = nil
        ticker?.cancel()
        modelWait?.cancel()
        channels = [:]
        mic = nil
        system = nil
        writer = nil
        meeting = nil
        startedAt = nil
        waitingForModel = false
        silenceStopsAt = nil
        microphoneName = nil
        restarts = [:]
        attached = []
        attaching = nil
        phase = .idle
    }
}
