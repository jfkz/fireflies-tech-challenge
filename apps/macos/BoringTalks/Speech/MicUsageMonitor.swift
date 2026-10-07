import CoreAudio
import Foundation

/// Which other apps have a microphone open right now, from Core Audio's process
/// objects (macOS 14+). Needs no permission and never opens the microphone itself.
///
/// Listens for processes coming and going and for each one starting or stopping
/// input; `refresh()` can also be called on a timer in case a change is missed.
@MainActor
final class MicUsageMonitor {
    /// Bundle IDs of the processes capturing input, BoringTalks excluded.
    private(set) var users: Set<String> = []
    var onChange: (() -> Void)?

    private var listListener: AudioObjectPropertyListenerBlock?
    private var inputListeners: [AudioObjectID: AudioObjectPropertyListenerBlock] = [:]
    private var bundleIDs: [AudioObjectID: String] = [:]
    private let own = Bundle.main.bundleIdentifier

    func start() {
        guard listListener == nil else { return }
        let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            MainActor.assumeIsolated {
                self?.subscribe()
                self?.refresh()
            }
        }
        var address = Self.address(kAudioHardwarePropertyProcessObjectList)
        if AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, .main, block) == noErr {
            listListener = block
        }
        subscribe()
        refresh()
    }

    func stop() {
        if let listListener {
            var address = Self.address(kAudioHardwarePropertyProcessObjectList)
            AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, .main, listListener)
            self.listListener = nil
        }
        for (object, block) in inputListeners {
            var address = Self.address(kAudioProcessPropertyIsRunningInput)
            AudioObjectRemovePropertyListenerBlock(object, &address, .main, block)
        }
        inputListeners = [:]
        bundleIDs = [:]
        users = []
    }

    func refresh() {
        let now = Set(Self.processObjects().filter(Self.isRunningInput).compactMap(bundleID).filter { !$0.isEmpty && $0 != own })
        guard now != users else { return }
        users = now
        onChange?()
    }

    /// One listener per process for its input starting or stopping.
    private func subscribe() {
        let objects = Set(Self.processObjects())
        for (object, block) in inputListeners where !objects.contains(object) {
            var address = Self.address(kAudioProcessPropertyIsRunningInput)
            AudioObjectRemovePropertyListenerBlock(object, &address, .main, block)
            inputListeners[object] = nil
            bundleIDs[object] = nil
        }
        for object in objects where inputListeners[object] == nil {
            let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
                MainActor.assumeIsolated { self?.refresh() }
            }
            var address = Self.address(kAudioProcessPropertyIsRunningInput)
            if AudioObjectAddPropertyListenerBlock(object, &address, .main, block) == noErr {
                inputListeners[object] = block
            }
        }
    }

    private func bundleID(_ object: AudioObjectID) -> String? {
        if let known = bundleIDs[object] { return known }
        var address = Self.address(kAudioProcessPropertyBundleID)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr,
              let id = value?.takeRetainedValue() as String? else { return nil }
        bundleIDs[object] = id
        return id
    }

    private static func processObjects() -> [AudioObjectID] {
        var address = address(kAudioHardwarePropertyProcessObjectList)
        var size = UInt32(0)
        let system = AudioObjectID(kAudioObjectSystemObject)
        guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr, size > 0 else { return [] }
        var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(system, &address, 0, nil, &size, &objects) == noErr else { return [] }
        return Array(objects.prefix(Int(size) / MemoryLayout<AudioObjectID>.size))
    }

    private static func isRunningInput(_ object: AudioObjectID) -> Bool {
        var address = address(kAudioProcessPropertyIsRunningInput)
        var running = UInt32(0)
        var size = UInt32(MemoryLayout<UInt32>.size)
        return AudioObjectGetPropertyData(object, &address, 0, nil, &size, &running) == noErr && running != 0
    }

    private static func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    }
}
