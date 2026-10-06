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
    let folders: AppFolders
    let preferences: Preferences
    let models: SpeechModels
    let recorder: MeetingRecorder

    private(set) var auth: Auth = .unknown
    private(set) var authError: String?
    private(set) var recentMeetings: [MeetingListItem] = []
    private(set) var meetingsError: String?
    private(set) var uploads = UploadQueue.Snapshot()
    private(set) var recordError: String?
    /// The live transcript window is showing.
    var liveWindowVisible = false
    /// Optional title for the next meeting.
    var titleDraft = ""

    @ObservationIgnored let queue: UploadQueue
    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let authenticator: DeviceAuthenticator
    @ObservationIgnored private let reachability = Reachability()
    @ObservationIgnored private var refreshTask: Task<Void, Never>?
    @ObservationIgnored var onLiveWindowChange: ((Bool) -> Void)?
    private static let log = Log.logger("app")

    init(config: AppConfig, folders: AppFolders = .standard, secrets: any SecretStore = KeychainStore()) {
        self.config = config
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
        Task {
            let url = await authenticator.begin(webURL: config.webURL, deviceName: Self.deviceName)
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

    func cancelSignIn() {
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
        Task {
            do {
                try await recorder.start(title: titleDraft, language: preferences.languageCode, uploadAudio: preferences.uploadAudio)
            } catch {
                recordError = error.localizedDescription
            }
        }
    }

    func stopMeeting() {
        Task {
            guard let meeting = await recorder.stop() else {
                recordError = "Nothing was recorded."
                return
            }
            titleDraft = ""
            await queue.enqueue(meeting)
        }
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
