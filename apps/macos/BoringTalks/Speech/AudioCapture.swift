// Core Audio process tap + microphone capture.
import AVFoundation
import BoringTalksKit
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

/// Captures one microphone through a Core Audio HAL unit bound to that device.
///
/// AVAudioEngine's input node opens the system default input as soon as it is
/// created; when that is a Bluetooth headset, the headset drops to call quality
/// even if another microphone is chosen afterwards. Binding a HAL unit to the
/// chosen device directly never touches the headset.
final class MicCapture {
    /// Called on the main queue when the default input device or its format changes.
    var onConfigurationChange: (() -> Void)?

    private var unit: AudioUnit?
    private var device = AudioDeviceID(kAudioObjectUnknown)
    private var buffer: AVAudioPCMBuffer?
    private var handler: ((AVAudioPCMBuffer) -> Void)?
    private var listeners: [(AudioObjectID, AudioObjectPropertyAddress, AudioObjectPropertyListenerBlock)] = []

    static func requestAccess() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: true
        case .notDetermined: await AVCaptureDevice.requestAccess(for: .audio)
        default: false
        }
    }

    /// Starts capturing from `device`, or from the system's default input when nil.
    func start(device chosen: AudioDeviceID? = nil, _ handler: @escaping (AVAudioPCMBuffer) -> Void) throws {
        guard let device = chosen ?? AudioInputs.defaultInput().map({ AudioDeviceID($0.id) }) else { throw CaptureError.noInputDevice }
        var description = AudioComponentDescription(componentType: kAudioUnitType_Output, componentSubType: kAudioUnitSubType_HALOutput,
                                                    componentManufacturer: kAudioUnitManufacturer_Apple, componentFlags: 0, componentFlagsMask: 0)
        guard let component = AudioComponentFindNext(nil, &description) else { throw CaptureError.noInputDevice }
        var instance: AudioUnit?
        try check(AudioComponentInstanceNew(component, &instance), "open the microphone")
        guard let unit = instance else { throw CaptureError.noInputDevice }
        self.unit = unit
        self.device = device
        self.handler = handler

        // Input on (element 1), output off (element 0), then the device.
        var on = UInt32(1), off = UInt32(0), id = device
        try check(AudioUnitSetProperty(unit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, 1, &on, 4), "enable microphone input")
        try check(AudioUnitSetProperty(unit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Output, 0, &off, 4), "disable playback")
        try check(AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0,
                                       &id, UInt32(MemoryLayout<AudioDeviceID>.size)), "use the microphone")

        // The device's own rate and channels, delivered as float32 non-interleaved.
        var hardware = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        try check(AudioUnitGetProperty(unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 1, &hardware, &size), "read the microphone format")
        guard hardware.mSampleRate > 0, hardware.mChannelsPerFrame > 0,
              let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: hardware.mSampleRate,
                                         channels: hardware.mChannelsPerFrame, interleaved: false),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 8192) else { throw CaptureError.noInputDevice }
        self.buffer = buffer
        var client = format.streamDescription.pointee
        try check(AudioUnitSetProperty(unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 1,
                                       &client, UInt32(MemoryLayout<AudioStreamBasicDescription>.size)), "set the microphone format")

        var callback = AURenderCallbackStruct(inputProc: { refCon, flags, timeStamp, bus, frames, _ in
            Unmanaged<MicCapture>.fromOpaque(refCon).takeUnretainedValue().render(flags, timeStamp, bus, frames)
        }, inputProcRefCon: Unmanaged.passUnretained(self).toOpaque())
        try check(AudioUnitSetProperty(unit, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global, 0,
                                       &callback, UInt32(MemoryLayout<AURenderCallbackStruct>.size)), "attach to the microphone")
        try check(AudioUnitInitialize(unit), "prepare the microphone")
        try check(AudioOutputUnitStart(unit), "start the microphone")

        // A new default input, or this device going away, means a restart.
        listen(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultInputDevice)
        listen(device, kAudioDevicePropertyDeviceIsAlive)
        listen(device, kAudioDevicePropertyNominalSampleRate)
    }

    func stop() {
        for (object, address, block) in listeners {
            var address = address
            AudioObjectRemovePropertyListenerBlock(object, &address, .main, block)
        }
        listeners = []
        if let unit {
            AudioOutputUnitStop(unit)
            AudioUnitUninitialize(unit)
            AudioComponentInstanceDispose(unit)
        }
        unit = nil
        handler = nil
    }

    deinit { stop() }

    private func render(_ flags: UnsafeMutablePointer<AudioUnitRenderActionFlags>, _ timeStamp: UnsafePointer<AudioTimeStamp>,
                        _ bus: UInt32, _ frames: UInt32) -> OSStatus {
        guard let unit, let buffer, let handler, frames <= buffer.frameCapacity else { return noErr }
        buffer.frameLength = frames
        let status = AudioUnitRender(unit, flags, timeStamp, bus, frames, buffer.mutableAudioBufferList)
        if status == noErr { handler(buffer) }
        return status
    }

    private func listen(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) {
        var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in self?.onConfigurationChange?() }
        if AudioObjectAddPropertyListenerBlock(object, &address, .main, block) == noErr {
            listeners.append((object, address, block))
        }
    }

    private func check(_ status: OSStatus, _ action: String) throws {
        guard status == noErr else {
            stop()
            throw CaptureError.coreAudio(action, status)
        }
    }
}

/// The Mac's audio input devices, for picking which microphone records "You".
enum AudioInputs {
    static func defaultInput() -> MicChoice.Device? {
        var id = AudioDeviceID(kAudioObjectUnknown)
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice,
                                                 mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &id) == noErr,
              id != kAudioObjectUnknown else { return nil }
        return device(id)
    }

    static func all() -> [MicChoice.Device] {
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices,
                                                 mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size = UInt32(0)
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else { return [] }
        var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids) == noErr else { return [] }
        return ids.filter(hasInput).compactMap(device)
    }

    private static func device(_ id: AudioDeviceID) -> MicChoice.Device? {
        var transport = UInt32(0)
        var address = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyTransportType,
                                                 mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size = UInt32(MemoryLayout<UInt32>.size)
        _ = AudioObjectGetPropertyData(id, &address, 0, nil, &size, &transport)
        var name: Unmanaged<CFString>?
        address.mSelector = kAudioObjectPropertyName
        size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        _ = AudioObjectGetPropertyData(id, &address, 0, nil, &size, &name)
        return MicChoice.Device(
            id: id,
            name: name?.takeRetainedValue() as String? ?? "Microphone",
            isBluetooth: transport == kAudioDeviceTransportTypeBluetooth || transport == kAudioDeviceTransportTypeBluetoothLE,
            isBuiltIn: transport == kAudioDeviceTransportTypeBuiltIn
        )
    }

    private static func hasInput(_ id: AudioDeviceID) -> Bool {
        var address = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams,
                                                 mScope: kAudioObjectPropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
        var size = UInt32(0)
        return AudioObjectGetPropertyDataSize(id, &address, 0, nil, &size) == noErr && size > 0
    }
}
