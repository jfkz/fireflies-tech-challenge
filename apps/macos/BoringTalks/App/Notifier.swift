import AppKit
import UserNotifications

/// System notifications for things that happen while the menu is closed: a quiet
/// meeting about to stop (with a Keep recording button), and one that stopped.
/// Without notification permission the stop is shown as an alert instead.
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    /// The warning's "Keep recording" button was pressed.
    var onKeepRecording: (() -> Void)?

    private var center: UNUserNotificationCenter { .current() }

    func setUp() {
        center.delegate = self
        let keep = UNNotificationAction(identifier: IDs.keepAction, title: "Keep recording")
        center.setNotificationCategories([
            UNNotificationCategory(identifier: IDs.silenceCategory, actions: [keep], intentIdentifiers: []),
        ])
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
    private func post(id: String, category: String?, title: String, body: String) async -> Bool {
        let status = await center.notificationSettings().authorizationStatus
        guard status == .authorized || status == .provisional else { return false }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        if let category { content.categoryIdentifier = category }
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
        guard response.actionIdentifier == IDs.keepAction else { return }
        await MainActor.run { onKeepRecording?() }
    }
}

private enum IDs {
    static let silenceCategory = "silence-warning"
    static let keepAction = "keep-recording"
    static let warning = "silence-warning"
    static let stopped = "silence-stopped"
}
