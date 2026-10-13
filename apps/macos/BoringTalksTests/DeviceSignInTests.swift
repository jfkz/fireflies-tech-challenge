import BoringTalksKit
import XCTest

final class PKCETests: XCTestCase {
    func testRFC7636AppendixBVector() {
        // RFC 7636 Appendix B: the verifier is base64url of these 32 octets.
        let octets: [UInt8] = [116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186,
                               22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121]
        XCTAssertEqual(PKCE.base64URL(Data(octets)), "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        XCTAssertEqual(pkce.challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    func testGeneratedVerifierIs43Base64URLCharacters() {
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        for _ in 0..<50 {
            let pkce = PKCE.generate()
            XCTAssertEqual(pkce.verifier.count, 43)
            XCTAssertEqual(pkce.challenge.count, 43)
            XCTAssertTrue(pkce.verifier.unicodeScalars.allSatisfy(allowed.contains))
            XCTAssertTrue(pkce.challenge.unicodeScalars.allSatisfy(allowed.contains))
            XCTAssertEqual(pkce.challenge, PKCE.challenge(for: pkce.verifier))
        }
        XCTAssertNotEqual(PKCE.generate().verifier, PKCE.generate().verifier)
    }

    func testBase64URLHasNoPaddingOrUnsafeCharacters() {
        XCTAssertEqual(PKCE.base64URL(Data([0xfb, 0xff, 0xfe])), "-__-")
        XCTAssertEqual(PKCE.base64URL(Data([0x01])), "AQ")
    }
}

final class DeviceLinkTests: XCTestCase {
    func testConnectURLEncodesTheDeviceName() {
        let url = DeviceLink.connectURL(webURL: URL(literal: "https://boringtalks.lol"),
                                        challenge: "E9Melhoa2OwvFrEMTJguCHaoeKT8bCwXyGz8Qmm4l-I",
                                        deviceName: "Mike's MacBook Pro & Co+ ü")
        XCTAssertEqual(url.absoluteString,
                       "https://boringtalks.lol/connect?challenge=E9Melhoa2OwvFrEMTJguCHaoeKT8bCwXyGz8Qmm4l-I"
                       + "&device=Mike%27s%20MacBook%20Pro%20%26%20Co%2B%20%C3%BC")
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(items?.first { $0.name == "device" }?.value, "Mike's MacBook Pro & Co+ ü")
    }

    func testConnectURLOnDevDashboard() {
        let url = DeviceLink.connectURL(webURL: URL(literal: "https://dev.boringtalks.lol"), challenge: "abc", deviceName: "Mac")
        XCTAssertEqual(url.absoluteString, "https://dev.boringtalks.lol/connect?challenge=abc&device=Mac")
    }

    func testConnectURLFromTheDevApp() {
        let url = DeviceLink.connectURL(webURL: URL(literal: "https://dev.boringtalks.lol"), challenge: "abc", deviceName: "Mac", flavor: .dev)
        XCTAssertEqual(url.absoluteString, "https://dev.boringtalks.lol/connect?challenge=abc&device=Mac&app=dev")
    }

    func testCallbackCode() throws {
        XCTAssertEqual(try DeviceLink.code(fromCallback: URL(literal: "boringtalks://callback?code=abc123")), "abc123")
        XCTAssertEqual(try DeviceLink.code(fromCallback: URL(literal: "boringtalks-dev://callback?code=dev1")), "dev1")
        XCTAssertEqual(DeviceLink.code(fromPasted: " boringtalks-dev://callback?code=p2 "), "p2")
        XCTAssertEqual(try DeviceLink.code(fromCallback: URL(literal: "BoringTalks://Callback?state=x&code=c%2Fd")), "c/d")
    }

    func testCallbackErrors() {
        XCTAssertThrowsError(try DeviceLink.code(fromCallback: URL(literal: "https://boringtalks.lol/callback?code=1"))) {
            XCTAssertEqual($0 as? DeviceLink.CallbackError, .notACallback)
        }
        XCTAssertThrowsError(try DeviceLink.code(fromCallback: URL(literal: "boringtalks://other?code=1"))) {
            XCTAssertEqual($0 as? DeviceLink.CallbackError, .notACallback)
        }
        XCTAssertThrowsError(try DeviceLink.code(fromCallback: URL(literal: "boringtalks://callback"))) {
            XCTAssertEqual($0 as? DeviceLink.CallbackError, .missingCode)
        }
        XCTAssertThrowsError(try DeviceLink.code(fromCallback: URL(literal: "boringtalks://callback?code="))) {
            XCTAssertEqual($0 as? DeviceLink.CallbackError, .missingCode)
        }
        XCTAssertThrowsError(try DeviceLink.code(fromCallback: URL(literal: "boringtalks://callback?error=access_denied"))) {
            XCTAssertEqual($0 as? DeviceLink.CallbackError, .denied("access_denied"))
        }
    }

    func testPastedCode() {
        XCTAssertEqual(DeviceLink.code(fromPasted: "  abc123\n"), "abc123")
        XCTAssertEqual(DeviceLink.code(fromPasted: "boringtalks://callback?code=xyz"), "xyz")
        XCTAssertNil(DeviceLink.code(fromPasted: ""))
        XCTAssertNil(DeviceLink.code(fromPasted: "two words"))
        XCTAssertNil(DeviceLink.code(fromPasted: "boringtalks://callback?error=denied"))
    }
}

/// A device-token endpoint that checks the verifier against the challenge it saw.
private final class FakeDeviceAPI: DeviceAuthAPI, @unchecked Sendable {
    var expectedChallenge: String?
    var requests: [DeviceTokenRequest] = []

    func exchangeDeviceCode(_ request: DeviceTokenRequest) async throws -> DeviceTokenResponse {
        requests.append(request)
        guard request.code == "good-code", PKCE.challenge(for: request.codeVerifier) == expectedChallenge else {
            throw APIError.rejected(status: 400, message: "Invalid code")
        }
        return try JSONDecoder().decode(DeviceTokenResponse.self, from: Fixture.data("device-token-response"))
    }
}

final class DeviceAuthenticatorTests: XCTestCase {
    private func challenge(in url: URL) -> String? {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "challenge" }?.value
    }

    func testSignInStoresTheTokenAndForgetsTheVerifier() async throws {
        let api = FakeDeviceAPI()
        let store = InMemorySecretStore()
        let auth = DeviceAuthenticator(api: api, store: store, account: "token")
        let url = await auth.begin(webURL: URL(literal: "https://boringtalks.lol"), deviceName: "Test Mac")
        api.expectedChallenge = challenge(in: url)
        XCTAssertNotNil(try store.read(account: "token.pending-verifier"))

        let credential = try await auth.complete(code: "good-code")
        XCTAssertEqual(credential.token, "btd_3q2+7w9yZx")
        XCTAssertEqual(credential.email, "mike@example.com")
        let token = await auth.token()
        XCTAssertEqual(token, "btd_3q2+7w9yZx")
        XCTAssertNil(try store.read(account: "token.pending-verifier"))

        // A new launch reads it back from the store.
        let relaunched = DeviceAuthenticator(api: api, store: store, account: "token")
        let restored = await relaunched.credential()
        XCTAssertEqual(restored, credential)

        await relaunched.signOut()
        let afterSignOut = await relaunched.token()
        XCTAssertNil(afterSignOut)
        XCTAssertNil(try store.readData(account: "token"))
    }

    func testCallbackAfterRelaunchUsesTheStoredVerifier() async throws {
        let api = FakeDeviceAPI()
        let store = InMemorySecretStore()
        let url = await DeviceAuthenticator(api: api, store: store, account: "token")
            .begin(webURL: URL(literal: "https://boringtalks.lol"), deviceName: "Mac")
        api.expectedChallenge = challenge(in: url)
        let relaunched = DeviceAuthenticator(api: api, store: store, account: "token")
        let credential = try await relaunched.complete(code: "good-code")
        XCTAssertEqual(credential.deviceID, "c4d3b2a1-0f9e-4d8c-b7a6-958473625140")
    }

    func testCompleteWithoutBeginFails() async {
        let auth = DeviceAuthenticator(api: FakeDeviceAPI(), store: InMemorySecretStore(), account: "token")
        do {
            try await auth.complete(code: "good-code")
            XCTFail("expected an error")
        } catch {
            XCTAssertTrue(error is DeviceAuthenticator.AuthError)
        }
    }

    func testRejectedCodeKeepsTheUserSignedOut() async {
        let api = FakeDeviceAPI()
        let auth = DeviceAuthenticator(api: api, store: InMemorySecretStore(), account: "token")
        let url = await auth.begin(webURL: URL(literal: "https://boringtalks.lol"), deviceName: "Mac")
        api.expectedChallenge = challenge(in: url)
        do {
            try await auth.complete(code: "stolen-code")
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? APIError, .rejected(status: 400, message: "Invalid code"))
        }
        let token = await auth.token()
        XCTAssertNil(token)
    }
}

final class KeychainStoreTests: XCTestCase {
    private let store = KeychainStore(service: "games.cutthecheese.boringtalks.tests")
    private let account = "test-\(UUID().uuidString)"

    override func tearDown() {
        try? store.delete(account: account)
        super.tearDown()
    }

    func testWriteReadUpdateDelete() throws {
        XCTAssertNil(try store.read(account: account))
        try store.write("first", account: account)
        XCTAssertEqual(try store.read(account: account), "first")
        try store.write("second", account: account)
        XCTAssertEqual(try store.read(account: account), "second")
        try store.delete(account: account)
        XCTAssertNil(try store.read(account: account))
        // Deleting what isn't there is fine.
        XCTAssertNoThrow(try store.delete(account: account))
    }

    func testServicesAreSeparate() throws {
        try store.write("secret", account: account)
        let other = KeychainStore(service: "games.cutthecheese.boringtalks.tests.other")
        XCTAssertNil(try other.read(account: account))
    }
}

final class AppConfigTests: XCTestCase {
    private func defaults(_ values: [String: String] = [:]) throws -> UserDefaults {
        let name = "BoringTalksTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        values.forEach { defaults.set($0.value, forKey: $0.key) }
        return defaults
    }

    func testProductionByDefault() throws {
        let config = AppConfig.resolve(arguments: ["BoringTalks"], defaults: try defaults())
        XCTAssertEqual(config.apiURL.absoluteString, "https://api.boringtalks.lol")
        XCTAssertEqual(config.webURL.absoluteString, "https://boringtalks.lol")
        XCTAssertTrue(config.isProduction)
        XCTAssertEqual(config.meetingURL(id: "abc").absoluteString, "https://boringtalks.lol/meetings/abc")
    }

    func testDefaultsThenArgumentsOverride() throws {
        let stored = try defaults(["apiURL": "https://api.dev.boringtalks.lol", "webURL": "https://dev.boringtalks.lol"])
        let fromDefaults = AppConfig.resolve(arguments: [], defaults: stored)
        XCTAssertEqual(fromDefaults.apiURL.absoluteString, "https://api.dev.boringtalks.lol")
        XCTAssertFalse(fromDefaults.isProduction)
        let fromArguments = AppConfig.resolve(arguments: ["x", "--api-url", "http://localhost:3001"], defaults: stored)
        XCTAssertEqual(fromArguments.apiURL.absoluteString, "http://localhost:3001")
        XCTAssertEqual(fromArguments.webURL.absoluteString, "https://dev.boringtalks.lol")
    }

    func testTheDevAppConnectsToDevUnlessToldOtherwise() throws {
        let config = AppConfig.resolve(arguments: ["x"], defaults: try defaults(), flavor: .dev)
        XCTAssertEqual(config.apiURL.absoluteString, "https://api.dev.boringtalks.lol")
        XCTAssertEqual(config.webURL.absoluteString, "https://dev.boringtalks.lol")
        XCTAssertFalse(config.isProduction)
        let local = AppConfig.resolve(arguments: ["x", "--api-url", "http://localhost:3001"], defaults: try defaults(), flavor: .dev)
        XCTAssertEqual(local.apiURL.absoluteString, "http://localhost:3001")
    }

    func testInvalidURLsAreIgnored() throws {
        let config = AppConfig.resolve(arguments: ["x", "--api-url", "not a url", "--web-url", "ftp://x.y"],
                                       defaults: try defaults(["apiURL": "javascript:alert(1)"]))
        XCTAssertEqual(config, AppConfig())
    }
}

final class AppFlavorTests: XCTestCase {
    func testReadFromInfoPlist() {
        XCTAssertEqual(AppFlavor.of(info: "dev"), .dev)
        XCTAssertEqual(AppFlavor.of(info: "Dev"), .dev)
        XCTAssertEqual(AppFlavor.of(info: "production"), .production)
        XCTAssertEqual(AppFlavor.of(info: nil), .production)
        XCTAssertEqual(AppFlavor.of(info: "staging"), .production)
        // The test bundle has no BTFlavor.
        XCTAssertEqual(AppFlavor.of(Bundle(for: AppFlavorTests.self)), .production)
    }

    func testTheTwoAppsKeepTheirThingsApart() {
        XCTAssertEqual(AppFlavor.production.callbackScheme, "boringtalks")
        XCTAssertEqual(AppFlavor.dev.callbackScheme, "boringtalks-dev")
        XCTAssertNotEqual(AppFlavor.production.keychainService, AppFlavor.dev.keychainService)
        XCTAssertEqual(AppFlavor.production.folders.root.lastPathComponent, "BoringTalks")
        XCTAssertEqual(AppFlavor.dev.folders.root.lastPathComponent, "BoringTalks Dev")
        XCTAssertEqual(AppFlavor.dev.displayName, "BoringTalks Dev")
        XCTAssertEqual(KeychainStore().service, AppFlavor.production.keychainService)
    }
}
