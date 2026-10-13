import Foundation
import os

/// Uploads finished meetings one step at a time, in the background:
/// create → audio (optional) → transcript → complete.
///
/// - Every change is persisted before the next request, so a relaunch resumes at
///   the step that was interrupted. Each step is idempotent on the server.
/// - Network and server errors retry with exponential backoff; going back online
///   retries at once. 401 pauses the whole queue until the user signs in again.
/// - Anything else the server refuses marks that meeting failed, for the user to
///   retry or discard.
public actor UploadQueue {
    public struct Snapshot: Equatable, Sendable {
        public var items: [PendingMeeting] = []
        public var isOnline = true
        /// The token was refused; nothing uploads until the user signs in again.
        public var needsSignIn = false
        /// The meeting being uploaded right now.
        public var activeID: UUID?
        /// Grows by one per finished upload, so observers know to refresh lists.
        public var uploadedCount = 0
        /// Server id of the last finished upload.
        public var lastUploadedRemoteID: String?

        public init() {}

        public var waiting: Int { items.filter { !$0.isFailed }.count }
        public var failed: Int { items.filter(\.isFailed).count }
    }

    private let api: any MeetingsAPI
    private let store: any UploadStore
    private let recordings: URL
    private let now: @Sendable () -> Date
    private let backoff: Backoff
    /// Days to keep audio on this Mac after it uploaded; 0 deletes it at once.
    private var keepAudioDays: Int
    private var snapshot = Snapshot()
    private var observer: (@Sendable (Snapshot) -> Void)?
    private var loop: Task<Void, Never>?
    private var wake: CheckedContinuation<Void, Never>?
    /// A kick that came while the loop was busy; the next sleep returns at once.
    private var woken = false
    private var processing = false
    private static let log = Log.logger("uploads")

    public init(api: any MeetingsAPI, store: any UploadStore, recordings: URL, keepAudioDays: Int = 7,
                backoff: Backoff = Backoff(), now: @escaping @Sendable () -> Date = { Date() }) {
        self.api = api
        self.store = store
        self.recordings = recordings
        self.keepAudioDays = keepAudioDays
        self.backoff = backoff
        self.now = now
    }

    // MARK: - Public

    public var current: Snapshot { snapshot }

    public func setObserver(_ observer: (@Sendable (Snapshot) -> Void)?) {
        self.observer = observer
        observer?(snapshot)
    }

    /// Reads what was left from the last run.
    public func load() {
        do {
            snapshot.items = try store.load()
        } catch {
            Self.log.error("couldn't read the upload queue: \(error.localizedDescription, privacy: .public)")
        }
        publish()
    }

    public func enqueue(_ meeting: PendingMeeting) {
        snapshot.items.removeAll { $0.id == meeting.id }
        snapshot.items.append(meeting)
        persist()
        kick()
    }

    public func setOnline(_ online: Bool) {
        guard online != snapshot.isOnline else { return }
        snapshot.isOnline = online
        if online {
            // Back online: don't sit out the backoff.
            for index in snapshot.items.indices { snapshot.items[index].nextAttemptAt = nil }
            persist()
            kick()
        } else {
            publish()
        }
    }

    /// After signing in again.
    public func resume() {
        snapshot.needsSignIn = false
        for index in snapshot.items.indices { snapshot.items[index].nextAttemptAt = nil }
        persist()
        kick()
    }

    public func setKeepAudioDays(_ days: Int) {
        keepAudioDays = max(0, days)
    }

    /// Tries a failed (or waiting) meeting again now.
    public func retry(_ id: UUID) {
        guard let index = snapshot.items.firstIndex(where: { $0.id == id }) else { return }
        snapshot.items[index].isFailed = false
        snapshot.items[index].attempts = 0
        snapshot.items[index].nextAttemptAt = nil
        persist()
        kick()
    }

    /// Drops a meeting from the queue (its audio file stays until it ages out).
    public func discard(_ id: UUID) {
        snapshot.items.removeAll { $0.id == id }
        persist()
    }

    /// Audio files the queue still needs; the janitor must not delete them.
    public var protectedFiles: Set<String> {
        Set(snapshot.items.compactMap(\.audioFileName))
    }

    /// Keeps processing in the background until `stop()`.
    public func start() {
        guard loop == nil else { return }
        loop = Task { await self.runLoop() }
    }

    public func stop() {
        loop?.cancel()
        loop = nil
        kick()
    }

    /// Wakes the background loop (new item, back online, signed in).
    public func kick() {
        if let wake {
            wake.resume()
            self.wake = nil
        } else {
            woken = true
        }
    }

    /// Uploads every meeting that is due now, step by step. Returns when each of
    /// them is done, failed, or waiting for a retry.
    public func processDue() async {
        guard !processing else { return }
        processing = true
        defer {
            processing = false
            snapshot.activeID = nil
            publish()
        }
        while snapshot.isOnline, !snapshot.needsSignIn, !Task.isCancelled,
              let item = snapshot.items.first(where: isDue) {
            snapshot.activeID = item.id
            publish()
            await upload(item.id)
        }
    }

    /// When the next waiting meeting is due, if any.
    public func nextDueDate() -> Date? {
        guard snapshot.isOnline, !snapshot.needsSignIn else { return nil }
        return snapshot.items.filter { !$0.isFailed }.map { $0.nextAttemptAt ?? .distantPast }.min()
    }

    // MARK: - Steps

    private func isDue(_ item: PendingMeeting) -> Bool {
        !item.isFailed && item.step != .done && (item.nextAttemptAt.map { $0 <= now() } ?? true)
    }

    private func audioURL(_ item: PendingMeeting) -> URL? {
        item.audioFileName.map { recordings.appendingPathComponent($0) }
    }

    private func audioExists(_ item: PendingMeeting) -> Bool {
        audioURL(item).map { FileManager.default.fileExists(atPath: $0.path) } ?? false
    }

    private func upload(_ id: UUID) async {
        while let index = snapshot.items.firstIndex(where: { $0.id == id }) {
            let item = snapshot.items[index]
            guard item.hasContent(audioExists: audioExists(item)) else {
                update(id) {
                    $0.isFailed = true
                    $0.lastError = "Nothing to upload: no transcript and no audio file."
                }
                return
            }
            if item.step == .done {
                finish(item)
                return
            }
            if item.step != .create, item.remoteID == nil {
                // Every later step needs the server id.
                update(id) { $0.step = .create }
                continue
            }
            do {
                let next = try await perform(item)
                update(id) {
                    $0 = next
                    $0.step = next.step(after: item.step, audioExists: self.audioExists(next))
                    $0.attempts = 0
                    $0.nextAttemptAt = nil
                    $0.lastError = nil
                }
            } catch let error as APIError {
                if !handle(error, for: item) { return }
            } catch {
                retryLater(item, error: error.localizedDescription)
                return
            }
        }
    }

    /// Runs one step; returns the meeting with what the step learned (its server id).
    private func perform(_ item: PendingMeeting) async throws -> PendingMeeting {
        var item = item
        switch item.step {
        case .create:
            if item.remoteID == nil {
                let request = CreateMeetingRequest(
                    title: item.title.map { String($0.prefix(APILimits.maxTitleLength)) },
                    startedAt: item.startedAt, language: item.language
                )
                let created = try await api.createMeeting(request, idempotencyKey: item.id.uuidString)
                item.remoteID = created.id
                Self.log.notice("created meeting \(created.id, privacy: .public)")
            }
        case .audio:
            guard let file = audioURL(item), let remoteID = item.remoteID else { return item }
            let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? Int) ?? 0
            guard size > 0, size <= APILimits.maxAudioBytes else {
                Self.log.notice("skipping audio of \(size) bytes")
                return item
            }
            let target = try await api.requestUploadURL(meetingID: remoteID, UploadUrlRequest(sizeBytes: size, channels: item.audioChannels))
            try await api.uploadAudio(file: file, to: target)
            Self.log.notice("uploaded \(size) bytes of audio for \(remoteID, privacy: .public)")
        case .transcript:
            guard let remoteID = item.remoteID else { return item }
            let segments = Array(item.segments.prefix(APILimits.maxSegments))
            try await api.putTranscript(meetingID: remoteID, TranscriptUpload(
                language: item.language, durationSec: item.durationSec, segments: segments))
        case .complete:
            guard let remoteID = item.remoteID else { return item }
            do {
                try await api.completeMeeting(meetingID: remoteID, CompleteMeetingRequest(durationSec: item.durationSec))
            } catch APIError.conflict {
                // Completed by an earlier attempt whose answer got lost.
            }
        case .done:
            break
        }
        return item
    }

    /// Returns true to go on with the next step of this meeting.
    private func handle(_ error: APIError, for item: PendingMeeting) -> Bool {
        switch error {
        case .unauthorized:
            snapshot.needsSignIn = true
            update(item.id) { $0.lastError = error.localizedDescription }
            return false
        case .notFound where item.remoteID != nil:
            // Deleted from the dashboard while waiting: nothing left to upload to.
            Self.log.notice("meeting \(item.remoteID ?? "", privacy: .public) is gone; dropping the upload")
            snapshot.items.removeAll { $0.id == item.id }
            persist()
            return false
        case .conflict where item.step != .create:
            // This step was already done.
            update(item.id) { $0.step = $0.step(after: item.step, audioExists: self.audioExists($0)) }
            return true
        case .server, .offline:
            retryLater(item, error: error.localizedDescription)
            return false
        case .rejected, .decoding, .notFound, .conflict:
            update(item.id) {
                $0.isFailed = true
                $0.lastError = error.localizedDescription
            }
            return false
        }
    }

    private func retryLater(_ item: PendingMeeting, error: String) {
        update(item.id) {
            $0.attempts += 1
            $0.nextAttemptAt = self.now().addingTimeInterval(self.backoff.delay(afterAttempts: $0.attempts))
            $0.lastError = error
        }
        Self.log.notice("upload of \(item.id, privacy: .public) will retry: \(error, privacy: .public)")
    }

    private func finish(_ item: PendingMeeting) {
        snapshot.items.removeAll { $0.id == item.id }
        snapshot.uploadedCount += 1
        snapshot.lastUploadedRemoteID = item.remoteID
        if keepAudioDays == 0, let file = audioURL(item) {
            try? FileManager.default.removeItem(at: file)
        }
        persist()
        Self.log.notice("meeting \(item.remoteID ?? "?", privacy: .public) uploaded")
    }

    private func update(_ id: UUID, _ change: (inout PendingMeeting) -> Void) {
        guard let index = snapshot.items.firstIndex(where: { $0.id == id }) else { return }
        change(&snapshot.items[index])
        persist()
    }

    private func persist() {
        do {
            try store.save(snapshot.items)
        } catch {
            Self.log.error("couldn't save the upload queue: \(error.localizedDescription, privacy: .public)")
        }
        publish()
    }

    private func publish() {
        observer?(snapshot)
    }

    // MARK: - Background loop

    private func runLoop() async {
        while !Task.isCancelled {
            await processDue()
            let wait = nextDueDate().map { max(0.5, $0.timeIntervalSince(now())) } ?? 3600
            await sleep(upTo: min(wait, 3600))
        }
    }

    /// Sleeps until `seconds` pass or `kick()` is called.
    private func sleep(upTo seconds: TimeInterval) async {
        if woken {
            woken = false
            return
        }
        let timer = Task {
            try? await Task.sleep(for: .seconds(seconds))
            self.kick()
        }
        await withCheckedContinuation { continuation in
            wake = continuation
        }
        timer.cancel()
        woken = false
    }
}
