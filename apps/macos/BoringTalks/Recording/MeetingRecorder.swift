import AVFoundation
import BoringTalksKit
import Observation

/// Records one meeting: the microphone is "You", what the Mac plays is everyone
/// else. Both channels run on one clock (seconds since Start), go to their own
/// transcriber, and are mixed into one AAC file. When the server is to transcribe
/// the meeting instead, nothing is transcribed here and the file keeps the two sides
/// on their own channels. Stop hands back a `PendingMeeting` for the upload queue.
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
    /// This meeting is transcribed here (false: recorded for the server to transcribe).
    private(set) var transcribesLocally = true
    /// The microphone recording "You" (shown in the menu).
    private(set) var microphoneName: String?
    /// See `Preferences.avoidBluetoothMic`; read when a meeting starts.
    @ObservationIgnored var avoidBluetoothMic = true
    /// Quiet this long (seconds) stops the meeting; 0 never does. Read when a meeting starts.
    @ObservationIgnored var silenceLimit: TimeInterval = 300

    enum AutoStopReason: Equatable {
        /// Nobody spoke for this many seconds.
        case silence(TimeInterval)
        /// The app holding the call released the microphone.
        case callEnded(app: String)
    }

    struct PendingStop: Equatable {
        var reason: AutoStopReason
        var at: Date
    }

    /// The recording stops by itself at this moment unless someone keeps it going.
    private(set) var pendingStop: PendingStop?
    /// The silence countdown began (once per quiet spell), with the seconds left; nil
    /// when it was called off (someone spoke, or the call-end countdown took over).
    @ObservationIgnored var onSilenceWarning: (@MainActor (TimeInterval?) -> Void)?
    /// Time to stop. The owner stops the meeting.
    @ObservationIgnored var onAutoStop: (@MainActor (AutoStopReason) -> Void)?
    let live = LiveTranscript()

    @ObservationIgnored private let models: SpeechModels
    @ObservationIgnored private let folders: AppFolders
    @ObservationIgnored private var channels: [AudioChannel: RecordingChannel] = [:]
    @ObservationIgnored private var mic: MicCapture?
    @ObservationIgnored private var system: SystemAudioCapture?
    /// Captures on their way up. One that comes back after `startLimit` is used only if it is
    /// still the latest for its side and the meeting is still on.
    @ObservationIgnored private var startingMic: MicCapture?
    @ObservationIgnored private var startingSystem: SystemAudioCapture?
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
    @ObservationIgnored private var callEnd = CallEndWatch()
    @ObservationIgnored private var endedCallApp: String?
    /// Meeting-clock seconds when the transcript last heard someone, per side.
    @ObservationIgnored private var lastSpeech: [AudioChannel: TimeInterval] = [:]
    @ObservationIgnored private var autoStopReported = false
    /// Meters for the menu while nothing records.
    @ObservationIgnored private let idleMeters: [AudioChannel: LevelMeter] = [.microphone: LevelMeter(), .system: LevelMeter()]
    private static let log = Log.logger("recorder")
    /// Core Audio start and stop calls, one serial queue per side, never the main thread:
    /// they can block for minutes when a device goes away mid-call (headphones unplugged).
    nonisolated static let micQueue = BlockingQueue(label: "games.cutthecheese.boringtalks.mic-control")
    nonisolated static let systemQueue = BlockingQueue(label: "games.cutthecheese.boringtalks.system-control")
    /// How long a side may take to start before the meeting carries on without it.
    static let startLimit: Duration = .seconds(10)

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

    func start(title: String?, language: String?, uploadAudio: Bool, transcribeLocally: Bool = true) async throws {
        guard phase == .idle else { return }
        phase = .starting
        transcribesLocally = transcribeLocally
        warnings = [:]
        records = []
        live.reset()
        registry = VoiceRegistry()
        silence = SilenceWatch(limit: silenceLimit)
        callEnd = CallEndWatch()
        endedCallApp = nil
        lastSpeech = [:]
        autoStopReported = false
        pendingStop = nil
        let id = UUID()
        let trimmedTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines)
        meeting = (id, trimmedTitle?.isEmpty == false ? trimmedTitle : nil, language, uploadAudio)

        do {
            try folders.create()
            let writer = try RecordingWriter(url: folders.recordings.appendingPathComponent("\(id.uuidString).m4a"),
                                             split: !transcribeLocally)
            self.writer = writer
            clockStart = ProcessInfo.processInfo.systemUptime
            startedAt = Date()
            for kind in AudioChannel.allCases {
                channels[kind] = RecordingChannel(kind: kind, clockStart: clockStart, writer: writer, transcribes: transcribeLocally)
            }

            // Keep both sides on the clock from the first moment: a side that is slow
            // to start (or never does) is filled with silence instead of stalling the mix.
            ticker = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(500))
                    self?.channels.values.forEach { $0.catchUp() }
                    self?.checkAutoStop()
                }
            }
            let micStarted = await startMic()
            // Core Audio blocks system-audio capture until the System Audio Recording
            // prompt is answered. Don't hold the meeting hostage to it: record the mic
            // now and let the other side join when it can.
            let system = Task { await self.startSystem() }
            systemStart = Task { _ = await system.value }
            let systemStarted = await Deadline.value(of: system, within: micStarted ? .seconds(3) : .seconds(60))
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
        Self.log.notice("recording \(id, privacy: .public)\(transcribeLocally ? "" : " for the server to transcribe", privacy: .public)")
        guard transcribeLocally else { return }
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
        stopCaptures()
        let elapsed = ProcessInfo.processInfo.systemUptime - clockStart
        // A model that has just arrived may be attaching right now.
        await attaching?.value

        var endings: [AudioChannel: RecordingChannel.Ending] = [:]
        for (kind, channel) in channels {
            endings[kind] = await channel.end(at: elapsed)
        }
        // The model may have finished loading just now.
        let missing = endings.keys.filter { !attached.contains($0) }
        if transcribesLocally, models.isReady, !missing.isEmpty {
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
        let transcribed = transcribesLocally && endings.allSatisfy { kind, ending in ending.transcribed || warnings[kind] != nil }
        let segments = transcribed ? SegmentAssembler.assemble(records) : []
        if !transcribed, transcribesLocally {
            Self.log.notice("no local transcript; the server will transcribe the audio")
        }
        let language = meeting.language ?? LanguageGuess.detect(segments.map(\.text).joined(separator: " "))
        let fileName = seconds > 0.5 ? writer.url.lastPathComponent : nil
        if fileName == nil { try? FileManager.default.removeItem(at: writer.url) }

        let pending = PendingMeeting(id: meeting.id, title: meeting.title, startedAt: startedAt,
                                     durationSec: Int(elapsed.rounded()), language: language, segments: segments,
                                     audioFileName: fileName, uploadAudio: meeting.uploadAudio,
                                     audioChannels: transcribesLocally ? nil : .micSystem)
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
        startingMic = capture
        let avoidBluetooth = avoidBluetoothMic
        let start = Task.detached { () -> Result<MicStarted, Error> in
            do {
                return .success(try await Self.micQueue.run {
                    let defaultInput = AudioInputs.defaultInput()
                    let chosen = MicChoice.pick(defaultInput: defaultInput, inputs: AudioInputs.all(), avoidBluetooth: avoidBluetooth)
                    try capture.start(device: chosen.map { AudioDeviceID($0.id) }) { buffer in channel.ingest(buffer) }
                    return MicStarted(name: (chosen ?? defaultInput)?.name, insteadOfBluetooth: chosen?.name)
                })
            } catch {
                return .failure(error)
            }
        }
        guard let outcome = await Deadline.value(of: start, within: Self.startLimit) else {
            stuck(.microphone)
            Task { [weak self] in
                let outcome = await start.value
                self?.micStarted(capture, outcome)
            }
            return false
        }
        return micStarted(capture, outcome)
    }

    private struct MicStarted: Sendable {
        var name: String?
        /// Set when a built-in microphone was picked over the Bluetooth headset.
        var insteadOfBluetooth: String?
    }

    @discardableResult
    private func micStarted(_ capture: MicCapture, _ outcome: Result<MicStarted, Error>) -> Bool {
        guard startingMic === capture, phase == .starting || phase == .recording else {
            // The meeting ended, or this side restarted again, while Core Audio was busy.
            capture.onConfigurationChange = nil
            if case .success = outcome { Self.micQueue.enqueue { capture.stop() } }
            return false
        }
        startingMic = nil
        switch outcome {
        case .success(let started):
            microphoneName = started.name
            if let name = started.insteadOfBluetooth {
                Self.log.notice("recording You with \(name, privacy: .public) instead of a Bluetooth headset")
            }
            mic = capture
            warnings[.microphone] = nil
            return true
        case .failure(let error):
            fail(.microphone, error.localizedDescription)
            return false
        }
    }

    private func startSystem() async -> Bool {
        guard let channel = channels[.system] else { return false }
        let capture = SystemAudioCapture()
        capture.onDeviceChange = { [weak self] in
            Task { @MainActor in self?.scheduleRestart(.system) }
        }
        startingSystem = capture
        do {
            // Core Audio blocks this call until the System Audio Recording prompt is answered.
            try await Self.systemQueue.run { try capture.start { buffer in channel.ingest(buffer) } }
        } catch {
            guard startingSystem === capture else { return false }
            startingSystem = nil
            fail(.system, "System audio: \(error.localizedDescription). Allow BoringTalks under System Settings › Privacy & Security › Screen & System Audio Recording.")
            return false
        }
        // The meeting may have ended (or this side restarted) while macOS was asking for
        // permission or busy.
        guard startingSystem === capture, phase == .starting || phase == .recording else {
            capture.onDeviceChange = nil
            Self.systemQueue.enqueue { capture.stop() }
            return false
        }
        startingSystem = nil
        system = capture
        warnings[.system] = nil
        return true
    }

    /// Core Audio hasn't come back in time. The meeting carries on (the timeline fills the gap
    /// with silence) and the side joins if Core Audio ever lets go.
    private func stuck(_ kind: AudioChannel) {
        let side = kind == .microphone ? "The microphone" : "System audio"
        warnings[kind] = "\(side) isn't responding: macOS audio is busy, often just after headphones are plugged in or out. Recording carries on, and it joins as soon as macOS lets go."
        Self.log.error("\(kind.rawValue, privacy: .public) start is stuck in Core Audio")
    }

    /// Stops the captures without waiting for Core Audio, which may take its time. A side
    /// still starting is stopped when it comes back.
    private func stopCaptures(_ kinds: [AudioChannel] = AudioChannel.allCases) {
        if kinds.contains(.microphone) {
            if let mic {
                mic.onConfigurationChange = nil
                Self.micQueue.enqueue { mic.stop() }
            }
            mic = nil
            startingMic = nil
        }
        if kinds.contains(.system) {
            if let system {
                system.onDeviceChange = nil
                Self.systemQueue.enqueue { system.stop() }
            }
            system = nil
            startingSystem = nil
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
            self.stopCaptures([kind])
            switch kind {
            case .microphone:
                _ = await self.startMic()
            case .system:
                let start = Task { await self.startSystem() }
                if await Deadline.value(of: start, within: Self.startLimit) == nil { self.stuck(.system) }
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
        for kind in pending {
            lastSpeech[kind] = max(lastSpeech[kind] ?? 0, meterActivity(of: [kind]))
        }
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
            lastSpeech[channel] = max(lastSpeech[channel] ?? 0, Double(event.end) / Double(SpeechFormat.rate))
        }
        guard event.isFinal, !event.text.isEmpty else { return }
        records.append(PhraseRecord(channel: channel, voice: event.speaker?.voice, startMs: startMs, endMs: endMs, text: event.text))
    }

    // MARK: - Stopping by itself

    /// Someone is still there: the quiet starts counting again from now, and a call-end
    /// countdown is called off.
    func keepRecording() {
        guard phase == .recording else { return }
        silence.keepRecording(at: clockNow)
        callEnd.cancel()
        endedCallApp = nil
        setPendingStop(nil)
    }

    /// The app holding the call released the microphone: stop once the other side has
    /// been quiet for a little while.
    func callEnded(app: String) {
        guard phase == .recording else { return }
        Self.log.notice("\(app, privacy: .public) released the microphone")
        endedCallApp = app
        callEnd.callEnded(at: clockNow)
    }

    /// …and took it back (a reconnect or a device switch).
    func callResumed() {
        guard endedCallApp != nil else { return }
        callEnd.cancel()
        endedCallApp = nil
        if case .callEnded = pendingStop?.reason { setPendingStop(nil) }
    }

    private var clockNow: TimeInterval { ProcessInfo.processInfo.systemUptime - clockStart }

    /// Called every half second while recording.
    private func checkAutoStop() {
        guard phase == .recording, !autoStopReported else { return }
        let now = clockNow
        if let app = endedCallApp {
            switch callEnd.verdict(lastOthers: othersActivity(now: now), now: now) {
            case .stop:
                return report(.callEnded(app: app))
            case .stopping(let left):
                return setPendingStop(PendingStop(reason: .callEnded(app: app), at: Date().addingTimeInterval(left)))
            case .recording:
                break
            }
        }
        guard silence.isOn else { return setPendingStop(nil) }
        let lastActivity = activity(of: Array(channels.keys), now: now)
        switch silence.verdict(lastActivity: lastActivity, now: now) {
        case .listening:
            setPendingStop(nil)
        case .warning(let left):
            if case .silence = pendingStop?.reason { return }
            Self.log.notice("quiet for \(Int(self.silence.quiet(lastActivity: lastActivity, now: now)), privacy: .public) s; stopping in \(Int(left), privacy: .public) s")
            setPendingStop(PendingStop(reason: .silence(silence.limit), at: Date().addingTimeInterval(left)))
        case .stop:
            report(.silence(silence.limit))
        }
    }

    private func report(_ reason: AutoStopReason) {
        autoStopReported = true
        setPendingStop(nil)
        Self.log.notice("stopping by itself: \(String(describing: reason), privacy: .public)")
        onAutoStop?(reason)
    }

    /// Updates the countdown the menu shows; tells the owner when a silence warning starts or ends.
    private func setPendingStop(_ new: PendingStop?) {
        let old = pendingStop
        // The call-end countdown moves each time the others speak; skip sub-second jitter.
        if let old, let new, old.reason == new.reason, abs(old.at.timeIntervalSince(new.at)) < 1 { return }
        guard old != new else { return }
        pendingStop = new
        let wasSilence = if case .silence = old?.reason { true } else { false }
        let isSilence = if case .silence = new?.reason { true } else { false }
        if isSilence, !wasSilence, let new {
            onSilenceWarning?(new.at.timeIntervalSinceNow)
        } else if wasSilence, !isSilence {
            onSilenceWarning?(nil)
        }
    }

    /// When someone was last heard on any of `kinds` (meeting clock): from the transcript,
    /// or from the level meter while that side has no transcriber yet.
    private func activity(of kinds: [AudioChannel], now: TimeInterval) -> TimeInterval {
        kinds.map { kind in
            attached.contains(kind) ? lastSpeech[kind] ?? 0 : meterActivity(of: [kind])
        }.max() ?? 0
    }

    /// The other side, or everyone when system audio isn't recorded.
    private func othersActivity(now: TimeInterval) -> TimeInterval {
        activity(of: channels[.system] != nil ? [.system] : Array(channels.keys), now: now)
    }

    /// When the meters of `kinds` last heard a clear sound (meeting clock).
    private func meterActivity(of kinds: [AudioChannel]) -> TimeInterval {
        let now = clockNow
        return kinds.compactMap { channels[$0] }.map { now - $0.meter.snapshot().sinceSound }.max() ?? 0
    }

    // MARK: - Teardown

    private func abandon() async {
        stopCaptures()
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
        stopCaptures()
        writer = nil
        meeting = nil
        startedAt = nil
        waitingForModel = false
        pendingStop = nil
        endedCallApp = nil
        microphoneName = nil
        restarts = [:]
        attached = []
        attaching = nil
        phase = .idle
    }
}
