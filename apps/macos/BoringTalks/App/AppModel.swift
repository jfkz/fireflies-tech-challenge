import AppKit
import BoringTalksKit
import Observation
import SystemConfiguration

/// The app's state for the menu, the settings and the live window: who is signed
/// in, the recorder, the upload queue and the latest meetings.
@MainActor @Observable
final class AppModel {
    enum Auth: Equatable {
        case unknown
        case signedOut
        /// The browser is open on the connect page; waiting for the callback.
        case waitingForBrowser
        case signedIn(email: String?)
    }

    let config: AppConfig
    let flavor: AppFlavor
    let folders: AppFolders
    let preferences: Preferences
    let models: SpeechModels
    let recorder: MeetingRecorder
    let notifier = Notifier()

    private(set) var auth: Auth = .unknown
    private(set) var authError: String?
    /// The sign-in link was copied rather than opened.
    private(set) var linkCopied = false
    private(set) var recentMeetings: [MeetingListItem] = []
    private(set) var meetingsError: String?
    private(set) var uploads = UploadQueue.Snapshot()
    private(set) var recordError: String?
    /// Why the last meeting stopped by itself (the call ended, nobody spoke), until dismissed.
    private(set) var autoStopNotice: String?
    /// A call app has been using the microphone: the name of the app we're asking about.
    private(set) var callOffer: String?
    /// The live transcript window is showing.
    var liveWindowVisible = false
    /// Optional title for the next meeting.
    var titleDraft = ""

    @ObservationIgnored let queue: UploadQueue
    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let authenticator: DeviceAuthenticator
    @ObservationIgnored private let reachability = Reachability()
    @ObservationIgnored private var refreshTask: Task<Void, Never>?
    @ObservationIgnored private let micMonitor = MicUsageMonitor()
    @ObservationIgnored private var callSignals = CallSignals()
    @ObservationIgnored private var callTask: Task<Void, Never>?
    @ObservationIgnored var onLiveWindowChange: ((Bool) -> Void)?
    private static let log = Log.logger("app")

    init(config: AppConfig, flavor: AppFlavor = .production, folders: AppFolders? = nil, secrets: (any SecretStore)? = nil) {
        let folders = folders ?? flavor.folders
        let secrets = secrets ?? KeychainStore(service: flavor.keychainService)
        self.config = config
        self.flavor = flavor
        self.folders = folders
        preferences = Preferences()
        let models = SpeechModels(folders: folders)
        self.models = models
        recorder = MeetingRecorder(models: models, folders: folders)

        // The token is read through the authenticator, which caches it.
        let account = "device-token.\(config.apiURL.host() ?? "api")"
        let tokenSource = TokenSource()
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
        let api = APIClient(baseURL: config.apiURL, userAgent: "BoringTalks-macOS/\(version)") { await tokenSource.token() }
        self.api = api
        authenticator = DeviceAuthenticator(api: api, store: secrets, account: account)
        tokenSource.authenticator = authenticator
        queue = UploadQueue(api: api, store: FileUploadStore(url: folders.uploadQueue), recordings: folders.recordings,
                            keepAudioDays: preferences.keepAudioDays)
        recorder.onSilenceWarning = { [weak self] left in
            guard let self else { return }
            if let left { notifier.warnSilence(stopsIn: left) } else { notifier.clearWarning() }
        }
        recorder.onAutoStop = { [weak self] reason in self?.stopByItself(reason) }
        notifier.onKeepRecording = { [weak self] in self?.keepRecording() }
        notifier.onRecordCall = { [weak self] in self?.recordCall() }
        notifier.onDeclineCall = { [weak self] in self?.declineCall() }
        notifier.onIgnoreCallApp = { [weak self] app in self?.ignoreCallApp(app) }
    }

    // MARK: - Launch

    func launch() {
        try? folders.create()
        Task {
            await queue.setObserver { snapshot in
                Task { @MainActor [weak self] in self?.receive(snapshot) }
            }
            await queue.load()
            if let credential = await authenticator.credential() {
                auth = .signedIn(email: credential.email)
                await queue.start()
                refreshMeetings()
            } else {
                auth = .signedOut
            }
            pruneRecordings()
        }
        reachability.start { [queue] online in
            Task { await queue.setOnline(online) }
        }
        // Start downloading the speech model right away; it takes a while the first time.
        Task { await models.prepare() }
        startRefreshing()
        startCallDetection()
    }

    private func receive(_ snapshot: UploadQueue.Snapshot) {
        let finishedOne = snapshot.uploadedCount != uploads.uploadedCount
        uploads = snapshot
        if snapshot.needsSignIn, case .signedIn = auth {
            Task { await signedOutByServer() }
        }
        if finishedOne {
            refreshMeetings()
            pruneRecordings()
        }
    }

    // MARK: - Sign in

    func signIn() {
        authError = nil
        linkCopied = false
        Task {
            let url = await authenticator.begin(webURL: config.webURL, deviceName: Self.deviceName, flavor: flavor)
            auth = .waitingForBrowser
            #if DEBUG
            // QA against a mock API: print the connect URL instead of opening a browser.
            if CommandLine.arguments.contains("--debug-print-connect-url") {
                print("CONNECT_URL \(url.absoluteString)")
                fflush(stdout)
                return
            }
            #endif
            NSWorkspace.shared.open(url)
        }
    }

    /// For when the default browser isn't the one the user is signed in to:
    /// starts the same sign-in, but puts the link on the clipboard instead of opening it.
    func copySignInLink() {
        authError = nil
        Task {
            let url = await authenticator.begin(webURL: config.webURL, deviceName: Self.deviceName, flavor: flavor)
            auth = .waitingForBrowser
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(url.absoluteString, forType: .string)
            linkCopied = true
        }
    }

    func cancelSignIn() {
        linkCopied = false
        if auth == .waitingForBrowser { auth = .signedOut }
    }

    /// `boringtalks://callback?code=…`
    func handle(url: URL) {
        do {
            let code = try DeviceLink.code(fromCallback: url)
            complete(code: code)
        } catch {
            authError = error.localizedDescription
            if auth == .waitingForBrowser { auth = .signedOut }
        }
    }

    /// The "Paste code" field: the code or the whole callback link.
    func submitPasted(_ text: String) {
        guard let code = DeviceLink.code(fromPasted: text) else {
            authError = "That doesn't look like a sign-in code."
            return
        }
        complete(code: code)
    }

    private func complete(code: String) {
        authError = nil
        Task {
            do {
                let credential = try await authenticator.complete(code: code)
                auth = .signedIn(email: credential.email)
                Self.log.notice("signed in as device \(credential.deviceID, privacy: .public)")
                await queue.resume()
                await queue.start()
                refreshMeetings()
                NSApp.activate()
            } catch {
                authError = error.localizedDescription
                auth = .signedOut
            }
        }
    }

    func signOut() {
        Task {
            await authenticator.signOut()
            await queue.stop()
            auth = .signedOut
            recentMeetings = []
        }
    }

    private func signedOutByServer() async {
        await authenticator.signOut()
        auth = .signedOut
        authError = "This Mac was signed out (the device was removed or its token expired). Sign in again — waiting uploads will continue."
        recentMeetings = []
    }

    static var deviceName: String {
        (SCDynamicStoreCopyComputerName(nil, nil) as String?) ?? Host.current().localizedName ?? "Mac"
    }

    // MARK: - Recording

    func startMeeting() {
        recordError = nil
        autoStopNotice = nil
        Task {
            do {
                recorder.avoidBluetoothMic = preferences.avoidBluetoothMic
                recorder.silenceLimit = TimeInterval(preferences.silenceStopMinutes * 60)
                if preferences.silenceStopMinutes > 0 { Task { await notifier.requestPermission() } }
                try await recorder.start(title: titleDraft, language: preferences.languageCode, uploadAudio: preferences.uploadAudio)
                callSignals.recordingStarted(now: ProcessInfo.processInfo.systemUptime)
                clearCallOffer()
            } catch {
                recordError = error.localizedDescription
            }
        }
    }

    func stopMeeting() {
        notifier.clearWarning()
        Task {
            let meeting = await recorder.stop()
            callSignals.recordingStopped()
            guard let meeting else {
                recordError = "Nothing was recorded."
                return
            }
            titleDraft = ""
            await queue.enqueue(meeting)
        }
    }

    /// The call ended or nobody spoke for a while: the meeting is over but the recording was left on.
    private func stopByItself(_ reason: MeetingRecorder.AutoStopReason) {
        let why = switch reason {
        case .silence(let limit): "Nobody spoke for \(SilenceWatch.describe(limit))"
        case .callEnded(let app): "The \(app) call ended"
        }
        Task {
            let meeting = await recorder.stop()
            callSignals.recordingStopped()
            let name = meeting?.title.map { "“\($0)”" } ?? "The meeting"
            let message: String
            if let meeting {
                titleDraft = ""
                await queue.enqueue(meeting)
                message = "\(why), so BoringTalks stopped recording. \(name) is uploading as usual."
            } else {
                message = "\(why), so BoringTalks stopped recording. Nothing was recorded."
            }
            autoStopNotice = message
            notifier.recordingStopped(message)
        }
    }

    /// The "Keep recording" button (in the menu or on the warning notification).
    func keepRecording() {
        recorder.keepRecording()
        notifier.clearWarning()
    }

    func dismissAutoStopNotice() {
        autoStopNotice = nil
    }

    // MARK: - Calls

    /// Watches which apps use the microphone: offers to record a call, and tells the
    /// recorder when the recorded call's app hangs up.
    private func startCallDetection() {
        micMonitor.onChange = { [weak self] in self?.evaluateCalls() }
        micMonitor.start()
        if preferences.offerToRecordCalls { Task { await notifier.requestPermission() } }
        callTask = Task { [weak self] in
            var ticks = 0
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                guard let self else { return }
                // The listeners report changes; a slow re-read covers any they miss.
                ticks += 1
                if ticks % 5 == 0 { self.micMonitor.refresh() }
                self.evaluateCalls()
            }
        }
    }

    private func evaluateCalls() {
        let extra = preferences.extraCallApps
        let active = micMonitor.users.compactMap { CallApps.identify($0, extra: extra) }
        var signedIn = false
        if case .signedIn = auth { signedIn = true }
        callSignals.offersEnabled = preferences.offerToRecordCalls && signedIn
        callSignals.ignored = Set(preferences.ignoredCallApps)
        let events = callSignals.update(active: active, now: ProcessInfo.processInfo.systemUptime,
                                        isRecording: recorder.phase != .idle)
        for event in events {
            switch event {
            case .offer(let app):
                Self.log.notice("\(app, privacy: .public) is in a call; offering to record")
                callOffer = app
                notifier.offerToRecord(app: app)
            case .withdraw:
                clearCallOffer()
            case .callEnded(let app):
                if preferences.stopWhenCallEnds { recorder.callEnded(app: app) }
            case .callResumed:
                recorder.callResumed()
            }
        }
    }

    /// Record (from the menu or the notification).
    func recordCall() {
        clearCallOffer()
        guard recorder.phase == .idle else { return }
        startMeeting()
    }

    /// Not now: asked again for the next call.
    func declineCall() {
        callSignals.declineOffer()
        clearCallOffer()
    }

    func ignoreCallApp(_ app: String) {
        if !preferences.ignoredCallApps.contains(app) { preferences.ignoredCallApps.append(app) }
        declineCall()
    }

    func askAgain(about app: String) {
        preferences.ignoredCallApps.removeAll { $0 == app }
    }

    private func clearCallOffer() {
        callOffer = nil
        notifier.withdrawOffer()
    }

    // MARK: - Meetings

    func refreshMeetings() {
        guard case .signedIn = auth else { return }
        Task {
            do {
                recentMeetings = try await api.listMeetings(limit: 5).items
                meetingsError = nil
            } catch APIError.unauthorized {
                await signedOutByServer()
            } catch {
                meetingsError = error.localizedDescription
            }
        }
    }

    /// While a meeting is being summarized, its status changes within a minute or so.
    private func startRefreshing() {
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                guard let self else { return }
                if self.recentMeetings.contains(where: { $0.status != .ready && $0.status != .failed }) {
                    self.refreshMeetings()
                }
            }
        }
    }

    func open(meeting: MeetingListItem) {
        NSWorkspace.shared.open(config.meetingURL(id: meeting.id))
    }

    func openDashboard() {
        NSWorkspace.shared.open(config.webURL.appendingPathComponent("meetings"))
    }

    func retryUploads() {
        Task {
            for item in uploads.items { await queue.retry(item.id) }
        }
    }

    func discardUpload(_ id: UUID) {
        Task { await queue.discard(id) }
    }

    func setKeepAudioDays(_ days: Int) {
        preferences.keepAudioDays = days
        Task {
            await queue.setKeepAudioDays(days)
            pruneRecordings()
        }
    }

    private func pruneRecordings() {
        let folder = folders.recordings
        let keep = preferences.keepAudioDays
        let current = recorder.currentFileName
        Task {
            var protected = await queue.protectedFiles
            if let current { protected.insert(current) }
            let deleted = RecordingJanitor.prune(folder: folder, keepDays: keep, protected: protected)
            if !deleted.isEmpty { Self.log.notice("deleted \(deleted.count) old recordings") }
        }
    }

    func toggleLiveWindow() {
        liveWindowVisible.toggle()
        onLiveWindowChange?(liveWindowVisible)
    }
}

/// Hands the API client the current token without a reference cycle at init.
private final class TokenSource: @unchecked Sendable {
    var authenticator: DeviceAuthenticator?

    func token() async -> String? {
        await authenticator?.token()
    }
}
