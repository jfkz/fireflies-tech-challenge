import Foundation

/// Which microphone records "You".
///
/// Opening a Bluetooth headset's microphone switches the headset from its stereo
/// music profile to the hands-free call profile: 16 kHz mono, so everything the
/// person hears gets worse for as long as the meeting records. When the system
/// microphone is such a headset and the Mac has a microphone of its own, use that
/// one instead and the headset keeps sounding as before.
public enum MicChoice {
    public struct Device: Equatable, Sendable {
        public let id: UInt32
        public let name: String
        public let isBluetooth: Bool
        public let isBuiltIn: Bool

        public init(id: UInt32, name: String, isBluetooth: Bool, isBuiltIn: Bool) {
            self.id = id
            self.name = name
            self.isBluetooth = isBluetooth
            self.isBuiltIn = isBuiltIn
        }
    }

    /// The device to record from; nil means the system default as it is.
    public static func pick(defaultInput: Device?, inputs: [Device], avoidBluetooth: Bool) -> Device? {
        guard avoidBluetooth, let defaultInput, defaultInput.isBluetooth else { return nil }
        return inputs.first { $0.isBuiltIn } ?? inputs.first { !$0.isBluetooth }
    }
}
