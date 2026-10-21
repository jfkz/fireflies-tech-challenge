import BoringTalksKit
import Carbon.HIToolbox
import Foundation

/// A shortcut that works in any app (Settings › Recording, ⌃⌥⌘R by default): Carbon's
/// RegisterEventHotKey, which needs no Accessibility permission. Its events arrive on the main thread.
@MainActor
final class GlobalHotkey {
    var onPressed: (() -> Void)?

    private var ref: EventHotKeyRef?
    private var handler: EventHandlerRef?
    /// "BTLK"
    private static let signature: OSType = 0x4254_4C4B

    /// Replaces the shortcut (nil: none). Returns why it couldn't be, or nil.
    func register(_ hotkey: Hotkey?) -> String? {
        unregister()
        guard let hotkey else { return nil }
        installHandler()
        var newRef: EventHotKeyRef?
        let status = RegisterEventHotKey(hotkey.keyCode, hotkey.carbonModifiers, EventHotKeyID(signature: Self.signature, id: 1),
                                         GetApplicationEventTarget(), 0, &newRef)
        guard status == noErr, let newRef else {
            return "\(hotkey) is already used by another app. Pick another shortcut."
        }
        ref = newRef
        return nil
    }

    func unregister() {
        if let ref { UnregisterEventHotKey(ref) }
        ref = nil
    }

    private func installHandler() {
        guard handler == nil else { return }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, userData in
            guard let userData else { return noErr }
            let hotkey = Unmanaged<GlobalHotkey>.fromOpaque(userData).takeUnretainedValue()
            MainActor.assumeIsolated { hotkey.onPressed?() }
            return noErr
        }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), &handler)
    }
}
