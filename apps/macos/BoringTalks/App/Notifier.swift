import AppKit
import UserNotifications

/// System notifications for things that happen while the menu is closed: a call
/// that started (Record it?), a quiet meeting about to stop (Keep recording), and a
/// meeting that stopped by itself. Without notification permission the stop is shown
/// as an alert instead, and the rest only in the menu.
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    /// The warning's "Keep recording" button was pressed.
    var onKeepRecording: (() -> Void)?
    /// The call offer was answered: Record (also a click on the notification).
    var onRecordCall: (() -> Void)?
    /// …Not now (or the notification was dismissed).
    var onDeclineCall: (() -> Void)?
    /// …Never ask for this app (its name).
    var onIgnoreCallApp: ((String) -> Void)?
    /// "Stop" on the notice of a call recorded by itself.
    var onStopRecording: (() -> Void)?

    private var center: UNUserNotificationCenter { .current() }

    func setUp() {
        center.delegate = self
        let keep = UNNotificationAction(identifier: IDs.keepAction, title: "Keep recording")
        let record = UNNotificationAction(identifier: IDs.recordAction, title: "Record")
        let notNow = UNNotificationAction(identifier: IDs.notNowAction, title: "Not now")
        let never = UNNotificationAction(identifier: IDs.neverAction, title: "Never for this app")
        let stop = UNNotificationAction(identifier: IDs.stopAction, title: "Stop", options: [.destructive])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: IDs.silenceCategory, actions: [keep], intentIdentifiers: []),
            UNNotificationCategory(identifier: IDs.callCategory, actions: [record, notNow, never], intentIdentifiers: [],
                                   options: [.customDismissAction]),
            UNNotificationCategory(identifier: IDs.autoStartCategory, actions: [stop], intentIdentifiers: []),
        ])
    }

    func offerToRecord(app: String) {
        Task {
            _ = await post(id: IDs.callOffer, category: IDs.callCategory, title: "\(app) is in a call. Record it?",
                           body: "BoringTalks can write this meeting down. Choose Record to start.", userInfo: ["app": app])
        }
    }

    /// A call app's call is being recorded without asking (Settings › Calls).
    func recordingCallAutomatically(app: String) {
        Task {
            _ = await post(id: IDs.autoStarted, category: IDs.autoStartCategory, title: "Recording the \(app) call",
                           body: "BoringTalks started recording by itself, as set in Settings. Stop it here or from the menu bar.",
                           userInfo: ["app": app])
        }
    }

    func clearAutoStartNotice() {
        center.removeDeliveredNotifications(withIdentifiers: [IDs.autoStarted])
    }

    func withdrawOffer() {
        center.removeDeliveredNotifications(withIdentifiers: [IDs.callOffer])
    }

    /// Asks once (macOS remembers the answer); called when a meeting starts.
    func requestPermission() async {
        guard await center.notificationSettings().authorizationStatus == .notDetermined else { return }
        _ = try? await center.requestAuthorization(options: [.alert, .sound])
    }

    func warnSilence(stopsIn seconds: TimeInterval) {
        Task {
            _ = await post(id: IDs.warning, category: IDs.silenceCategory, title: "Still in a meeting?",
                           body: "Nobody has spoken for a while. BoringTalks stops recording in \(Int(seconds.rounded())) seconds unless you keep it going.")
        }
    }

    func clearWarning() {
        center.removeDeliveredNotifications(withIdentifiers: [IDs.warning])
    }

    func recordingStopped(_ message: String) {
        clearWarning()
        Task {
            guard !(await post(id: IDs.stopped, category: nil, title: "Recording stopped", body: message)) else { return }
            // No permission for notifications: the message must still be seen.
            NSApp.activate()
            let alert = NSAlert()
            alert.messageText = "Recording stopped"
            alert.informativeText = message
            alert.addButton(withTitle: "OK")
            alert.runModal()
        }
    }

    /// False when notifications aren't allowed.
    private func post(id: String, category: String?, title: String, body: String, userInfo: [String: String] = [:]) async -> Bool {
        let status = await center.notificationSettings().authorizationStatus
        guard status == .authorized || status == .provisional else { return false }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        if let category { content.categoryIdentifier = category }
        content.userInfo = userInfo
        do {
            try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
            return true
        } catch {
            return false
        }
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// A menu-bar app is often the active one; show the banner anyway.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let action = response.actionIdentifier
        let content = response.notification.request.content
        let isCallOffer = content.categoryIdentifier == IDs.callCategory
        let app = content.userInfo["app"] as? String
        await MainActor.run {
            switch action {
            case IDs.keepAction: onKeepRecording?()
            case IDs.recordAction: onRecordCall?()
            case UNNotificationDefaultActionIdentifier where isCallOffer: onRecordCall?()
            case IDs.notNowAction, UNNotificationDismissActionIdentifier where isCallOffer: onDeclineCall?()
            case IDs.stopAction: onStopRecording?()
            case IDs.neverAction: if let app { onIgnoreCallApp?(app) }
            default: break
            }
        }
    }
}

private enum IDs {
    static let silenceCategory = "silence-warning"
    static let keepAction = "keep-recording"
    static let warning = "silence-warning"
    static let stopped = "silence-stopped"
    static let callCategory = "call-started"
    static let callOffer = "call-offer"
    static let recordAction = "record-call"
    static let notNowAction = "not-now"
    static let neverAction = "never-for-app"
    static let autoStartCategory = "call-recording"
    static let autoStarted = "call-auto-started"
    static let stopAction = "stop-recording"
}
