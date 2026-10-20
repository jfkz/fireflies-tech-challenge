import AppKit
import BoringTalksKit
import SwiftUI

/// The start/stop shortcut in Settings: click it and press the keys (Escape cancels), or reset it.
/// While it listens, the shortcut being changed is off, so pressing it doesn't start a recording.
struct ShortcutRecorder: View {
    let shortcut: String
    let onChange: @MainActor (String) -> Void
    let onListening: @MainActor (Bool) -> Void

    @State private var listening = false
    @State private var monitor: Any?

    var body: some View {
        HStack(spacing: 6) {
            Button(listening ? "Press the keys…" : (shortcut.isEmpty ? "None" : shortcut)) {
                listening ? stop() : start()
            }
            .monospaced()
            .accessibilityLabel(listening ? "Press the new shortcut" : "Start/stop shortcut: \(shortcut.isEmpty ? "none" : shortcut)")
            Button("Default") { onChange(Hotkey.defaultText) }
            Button("Clear") { onChange("") }
        }
        .onDisappear { stop() }
    }

    private func start() {
        listening = true
        onListening(true)
        // Local monitors run on the main thread; every key goes to the recorder while it listens.
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            let keyCode = event.keyCode
            let flags = event.modifierFlags
            MainActor.assumeIsolated { handle(keyCode: keyCode, flags: flags) }
            return nil
        }
    }

    private func handle(keyCode: UInt16, flags: NSEvent.ModifierFlags) {
        // Escape
        if keyCode == 53 {
            stop()
            return
        }
        var modifiers: Hotkey.Modifiers = []
        if flags.contains(.control) { modifiers.insert(.control) }
        if flags.contains(.option) { modifiers.insert(.option) }
        if flags.contains(.shift) { modifiers.insert(.shift) }
        if flags.contains(.command) { modifiers.insert(.command) }
        if let key = Hotkey.key(forKeyCode: keyCode), let hotkey = Hotkey(modifiers: modifiers, key: key) {
            onChange(hotkey.description)
            stop()
        }
    }

    private func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        if listening {
            listening = false
            onListening(false)
        }
    }
}
