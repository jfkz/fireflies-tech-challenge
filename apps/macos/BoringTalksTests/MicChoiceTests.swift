import XCTest
@testable import BoringTalksKit

final class MicChoiceTests: XCTestCase {
    private let headset = MicChoice.Device(id: 84, name: "MAJOR IV", isBluetooth: true, isBuiltIn: false)
    private let builtIn = MicChoice.Device(id: 70, name: "MacBook Air Microphone", isBluetooth: false, isBuiltIn: true)
    private let usb = MicChoice.Device(id: 91, name: "Yeti", isBluetooth: false, isBuiltIn: false)

    func testBluetoothDefaultUsesTheBuiltInMic() {
        XCTAssertEqual(MicChoice.pick(defaultInput: headset, inputs: [headset, usb, builtIn], avoidBluetooth: true), builtIn)
    }

    func testFallsBackToAnotherWiredMic() {
        XCTAssertEqual(MicChoice.pick(defaultInput: headset, inputs: [headset, usb], avoidBluetooth: true), usb)
    }

    func testKeepsTheDefaultWhenThereIsNoOtherMic() {
        XCTAssertNil(MicChoice.pick(defaultInput: headset, inputs: [headset], avoidBluetooth: true))
    }

    func testLeavesWiredDefaultsAlone() {
        XCTAssertNil(MicChoice.pick(defaultInput: usb, inputs: [usb, builtIn], avoidBluetooth: true))
        XCTAssertNil(MicChoice.pick(defaultInput: nil, inputs: [builtIn], avoidBluetooth: true))
    }

    func testCanBeTurnedOff() {
        XCTAssertNil(MicChoice.pick(defaultInput: headset, inputs: [headset, builtIn], avoidBluetooth: false))
    }
}
