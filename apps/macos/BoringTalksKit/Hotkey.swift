import Foundation

/// A global shortcut such as "⌃⌥⌘R": at least one modifier and a letter, digit, F-key or Space.
/// Kept in UserDefaults as written here; `keyCode` and `carbonModifiers` are what Carbon's
/// RegisterEventHotKey takes.
public struct Hotkey: Equatable, Sendable, CustomStringConvertible {
    public struct Modifiers: OptionSet, Hashable, Sendable {
        public let rawValue: UInt32
        public init(rawValue: UInt32) { self.rawValue = rawValue }
        public static let control = Modifiers(rawValue: 1 << 0)
        public static let option = Modifiers(rawValue: 1 << 1)
        public static let shift = Modifiers(rawValue: 1 << 2)
        public static let command = Modifiers(rawValue: 1 << 3)
    }

    /// Starts and stops recording unless changed in Settings.
    public static let defaultText = "⌃⌥⌘R"

    public let modifiers: Modifiers
    /// "R", "7", "F5", "Space".
    public let key: String

    /// From what was pressed; nil without a modifier or a usable key.
    public init?(modifiers: Modifiers, key: String) {
        guard !modifiers.isEmpty, let name = Self.normalize(key) else { return nil }
        self.modifiers = modifiers
        self.key = name
    }

    /// The shortcut written as `description` ("⌃⌥⌘R"); nil when empty or not one.
    public init?(_ text: String) {
        var modifiers: Modifiers = []
        var rest = Substring(text.trimmingCharacters(in: .whitespaces))
        while let first = rest.first, let modifier = Self.symbols.first(where: { $0.symbol == first })?.modifier {
            modifiers.insert(modifier)
            rest = rest.dropFirst()
        }
        self.init(modifiers: modifiers, key: String(rest))
    }

    /// "⌃⌥⇧⌘R": always this order, as macOS menus write them.
    public var description: String {
        Self.symbols.filter { modifiers.contains($0.modifier) }.map { String($0.symbol) }.joined() + key
    }

    /// cmdKey, shiftKey, optionKey, controlKey from Carbon's Events.h.
    public var carbonModifiers: UInt32 {
        var mask: UInt32 = 0
        if modifiers.contains(.command) { mask |= 0x0100 }
        if modifiers.contains(.shift) { mask |= 0x0200 }
        if modifiers.contains(.option) { mask |= 0x0800 }
        if modifiers.contains(.control) { mask |= 0x1000 }
        return mask
    }

    /// The virtual key code (kVK_…) of `key`.
    public var keyCode: UInt32 { UInt32(Self.keyCodes[key] ?? 0) }

    /// The key a virtual key code stands for (from an NSEvent), when it can be a shortcut.
    public static func key(forKeyCode code: UInt16) -> String? {
        keyCodes.first(where: { $0.value == code })?.key
    }

    private static let symbols: [(symbol: Character, modifier: Modifiers)] = [
        ("⌃", .control), ("⌥", .option), ("⇧", .shift), ("⌘", .command),
    ]

    private static func normalize(_ key: String) -> String? {
        let name = key.trimmingCharacters(in: .whitespaces)
        if name.lowercased() == "space" { return "Space" }
        let upper = name.uppercased()
        return keyCodes[upper] == nil ? nil : upper
    }

    /// ANSI key codes (Carbon's kVK_ANSI_… and kVK_F…).
    private static let keyCodes: [String: UInt16] = [
        "A": 0, "S": 1, "D": 2, "F": 3, "H": 4, "G": 5, "Z": 6, "X": 7, "C": 8, "V": 9, "B": 11, "Q": 12,
        "W": 13, "E": 14, "R": 15, "Y": 16, "T": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
        "9": 25, "7": 26, "8": 28, "0": 29, "O": 31, "U": 32, "I": 34, "P": 35, "L": 37, "J": 38, "K": 40,
        "N": 45, "M": 46, "Space": 49,
        "F1": 122, "F2": 120, "F3": 99, "F4": 118, "F5": 96, "F6": 97, "F7": 98, "F8": 100, "F9": 101,
        "F10": 109, "F11": 103, "F12": 111, "F13": 105, "F14": 107, "F15": 113, "F16": 106, "F17": 64,
        "F18": 79, "F19": 80, "F20": 90,
    ]
}
