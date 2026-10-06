// Core Audio process tap + microphone capture, from Talking Heads.
import AVFoundation
import AudioToolbox
import CoreAudio

enum CaptureError: LocalizedError {
    case coreAudio(String, OSStatus)
    case noInputDevice
    case microphoneDenied

    var errorDescription: String? {
        switch self {
        case .coreAudio(let action, let status):
            "Couldn't \(action) (error \(status))"
        case .noInputDevice:
            "No microphone found"
        case .microphoneDenied:
            "Microphone access is off — allow it in System Settings › Privacy & Security"
        }
    }
}

/// Captures everything the Mac plays through a Core Audio process tap (macOS 14.2+).
/// Asks for "System Audio Recording" permission the first time it starts.
final class SystemAudioCapture: @unchecked Sendable {
    /// Called on the main queue when the default output device changes.
    var onDeviceChange: (() -> Void)?

    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private var deviceListener: AudioObjectPropertyListenerBlock?
    private let queue = DispatchQueue(label: "BoringTalks.system-audio", qos: .userInteractive)
    /// What the tap reports, and the rate the capture device really runs at (diagnostics).
    private(set) var tapFormat = AudioStreamBasicDescription()
    private(set) var aggregateRate: Float64 = 0

    func start(_ handler: @escaping (AVAudioPCMBuffer) -> Void) throws {
        let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        description.uuid = UUID()
        description.name = "BoringTalks"
        description.muteBehavior = .unmuted
        description.isPrivate = true
        try check(AudioHardwareCreateProcessTap(description, &tapID), "create the system audio tap")

        var streamDescription = AudioStreamBasicDescription()
        try check(Self.read(tapID, kAudioTapPropertyFormat, into: &streamDescription), "read the system audio format")
        tapFormat = streamDescription

        let outputUID = try Self.defaultOutputDeviceUID()
        let configuration: [String: Any] = [
            kAudioAggregateDeviceNameKey: "BoringTalks Tap",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceMainSubDeviceKey: outputUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
            kAudioAggregateDeviceTapListKey: [[
                kAudioSubTapDriftCompensationKey: true,
                kAudioSubTapUIDKey: description.uuid.uuidString,
            ]],
        ]
        try check(AudioHardwareCreateAggregateDevice(configuration as CFDictionary, &aggregateID), "create the capture device")
        // The aggregate device runs at the output device's rate, which is not always the
        // rate the tap reports: a Bluetooth headset in hands-free mode plays at 16 kHz
        // while the tap says 48 kHz. Buffers arrive at the device rate, so label them with it,
        // or the audio comes out slowed down and unintelligible.
        var deviceRate = Float64(0)
        if Self.read(aggregateID, kAudioDevicePropertyNominalSampleRate, into: &deviceRate) == noErr, deviceRate > 0 {
            aggregateRate = deviceRate
            streamDescription.mSampleRate = deviceRate
        }
        guard let format = AVAudioFormat(streamDescription: &streamDescription) else {
            throw CaptureError.coreAudio("read the system audio format", -1)
        }
        try check(AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, queue) { _, inputData, _, _, _ in
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: inputData, deallocator: nil) else { return }
            handler(buffer)
        }, "attach to the capture device")
        try check(AudioDeviceStart(aggregateID, procID), "start capturing system audio")
        listenForOutputChanges()
    }

    func stop() {
        if let deviceListener {
            var address = Self.address(kAudioHardwarePropertyDefaultOutputDevice)
            AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, .main, deviceListener)
            self.deviceListener = nil
        }
        if aggregateID != kAudioObjectUnknown {
            if let procID {
                AudioDeviceStop(aggregateID, procID)
                AudioDeviceDestroyIOProcID(aggregateID, procID)
            }
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = AudioObjectID(kAudioObjectUnknown)
            procID = nil
        }
        if tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = AudioObjectID(kAudioObjectUnknown)
        }
    }

    deinit { stop() }

    private func listenForOutputChanges() {
        var address = Self.address(kAudioHardwarePropertyDefaultOutputDevice)
        let listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in self?.onDeviceChange?() }
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, .main, listener)
        deviceListener = listener
    }

    private func check(_ status: OSStatus, _ action: String) throws {
        guard status == noErr else {
            stop()
            throw CaptureError.coreAudio(action, status)
        }
    }

    private static func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    }

    private static func read<T>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, into value: inout T) -> OSStatus {
        var address = address(selector)
        var size = UInt32(MemoryLayout<T>.size)
        return withUnsafeMutablePointer(to: &value) {
            AudioObjectGetPropertyData(object, &address, 0, nil, &size, $0)
        }
    }

    private static func defaultOutputDeviceUID() throws -> String {
        var device = AudioDeviceID(kAudioObjectUnknown)
        var status = read(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultOutputDevice, into: &device)
        guard status == noErr, device != kAudioObjectUnknown else {
            throw CaptureError.coreAudio("find the output device", status)
        }
        var uid: Unmanaged<CFString>?
        status = read(device, kAudioDevicePropertyDeviceUID, into: &uid)
        guard status == noErr, let uid else {
            throw CaptureError.coreAudio("read the output device", status)
        }
        return uid.takeRetainedValue() as String
    }
}

/// Captures the default microphone.
final class MicCapture {
    /// Called on the main queue when the input device or its format changes.
    var onConfigurationChange: (() -> Void)?

    private let engine = AVAudioEngine()
    private var observer: NSObjectProtocol?

    static func requestAccess() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: true
        case .notDetermined: await AVCaptureDevice.requestAccess(for: .audio)
        default: false
        }
    }

    func start(_ handler: @escaping (AVAudioPCMBuffer) -> Void) throws {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw CaptureError.noInputDevice }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in handler(buffer) }
        engine.prepare()
        try engine.start()
        observer = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            self?.onConfigurationChange?()
        }
    }

    func stop() {
        if let observer {
            NotificationCenter.default.removeObserver(observer)
            self.observer = nil
        }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}
