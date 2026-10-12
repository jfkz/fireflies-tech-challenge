import Foundation

/// The browser half of signing a Mac in: the page the app opens, and the
/// `boringtalks://callback?code=…` link the dashboard sends back (`boringtalks-dev://` for BoringTalks Dev).
public enum DeviceLink {
    public static let callbackSchemes = AppFlavor.allCases.map(\.callbackScheme)
    public static let callbackHost = "callback"

    public enum CallbackError: Error, Equatable, LocalizedError {
        case notACallback
        case denied(String)
        case missingCode

        public var errorDescription: String? {
            switch self {
            case .notACallback: "That isn't a BoringTalks sign-in link."
            case .denied(let reason): "Sign-in was cancelled (\(reason))."
            case .missingCode: "The sign-in link has no code in it."
            }
        }
    }

    /// `https://boringtalks.lol/connect?challenge=<c>&device=<name>`, plus `&app=dev` from BoringTalks Dev
    /// so the dashboard sends the code back on its scheme.
    public static func connectURL(webURL: URL, challenge: String, deviceName: String, flavor: AppFlavor = .production) -> URL {
        let page = webURL.appendingPathComponent("connect")
        var query = "challenge=\(encode(challenge))&device=\(encode(deviceName))"
        if flavor != .production { query += "&app=\(flavor.rawValue)" }
        guard var components = URLComponents(url: page, resolvingAgainstBaseURL: false) else { return page }
        components.percentEncodedQuery = query
        return components.url ?? page
    }

    /// The one-time code from the callback link.
    public static func code(fromCallback url: URL) throws -> String {
        guard let scheme = url.scheme?.lowercased(), callbackSchemes.contains(scheme), url.host?.lowercased() == callbackHost else {
            throw CallbackError.notACallback
        }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let error = items.first(where: { $0.name == "error" })?.value {
            throw CallbackError.denied(error)
        }
        guard let code = items.first(where: { $0.name == "code" })?.value?.trimmingCharacters(in: .whitespaces),
              !code.isEmpty else {
            throw CallbackError.missingCode
        }
        return code
    }

    /// What the user pasted into "Paste code": the bare code, or the whole callback link.
    public static func code(fromPasted text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if callbackSchemes.contains(where: { trimmed.lowercased().hasPrefix("\($0)://") }), let url = URL(string: trimmed) {
            return try? code(fromCallback: url)
        }
        guard !trimmed.contains(where: \.isWhitespace), trimmed.count <= 512 else { return nil }
        return trimmed
    }

    /// Percent-encodes everything but the RFC 3986 unreserved characters, so names
    /// like "Mike's MacBook Pro & Co" survive the trip.
    static func encode(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        // `alphanumerics` includes non-ASCII letters; those must be encoded too.
        return value.unicodeScalars.map { scalar in
            scalar.isASCII && allowed.contains(scalar)
                ? String(scalar)
                : String(scalar).utf8.map { String(format: "%%%02X", $0) }.joined()
        }.joined()
    }
}

/// What the Keychain keeps for a signed-in Mac.
public struct DeviceCredential: Codable, Equatable, Sendable {
    public var token: String
    public var deviceID: String
    public var email: String?
    public var name: String?

    public init(token: String, deviceID: String, email: String?, name: String?) {
        self.token = token
        self.deviceID = deviceID
        self.email = email
        self.name = name
    }
}

/// Signs this Mac in with PKCE and keeps its device token in the Keychain.
public actor DeviceAuthenticator {
    private let api: any DeviceAuthAPI
    private let store: any SecretStore
    private let account: String
    private var pending: PKCE?
    private var cached: DeviceCredential?
    private var loaded = false

    /// `account` names the Keychain item; one per API host, so dev and prod
    /// sign-ins don't overwrite each other.
    public init(api: any DeviceAuthAPI, store: any SecretStore, account: String) {
        self.api = api
        self.store = store
        self.account = account
    }

    private var pendingAccount: String { "\(account).pending-verifier" }

    /// Starts a sign-in: remembers a fresh verifier and returns the page to open.
    public func begin(webURL: URL, deviceName: String, flavor: AppFlavor = .production) -> URL {
        let pkce = PKCE.generate()
        pending = pkce
        // Survives a relaunch between opening the browser and the callback.
        try? store.write(pkce.verifier, account: pendingAccount)
        return DeviceLink.connectURL(webURL: webURL, challenge: pkce.challenge, deviceName: deviceName, flavor: flavor)
    }

    /// Swaps the one-time code for the device token and stores it.
    @discardableResult
    public func complete(code: String) async throws -> DeviceCredential {
        let verifier = pending?.verifier ?? (try? store.read(account: pendingAccount)).flatMap { $0 }
        guard let verifier else { throw AuthError.noSignInInProgress }
        let response = try await api.exchangeDeviceCode(DeviceTokenRequest(code: code, codeVerifier: verifier))
        let credential = DeviceCredential(token: response.token, deviceID: response.deviceId,
                                          email: response.user.email, name: response.user.name)
        try store.write(try JSONEncoder().encode(credential), account: account)
        try? store.delete(account: pendingAccount)
        pending = nil
        cached = credential
        loaded = true
        return credential
    }

    public func credential() -> DeviceCredential? {
        if !loaded {
            loaded = true
            if let data = try? store.readData(account: account) {
                cached = try? JSONDecoder().decode(DeviceCredential.self, from: data)
            }
        }
        return cached
    }

    public func token() -> String? { credential()?.token }

    public func signOut() {
        try? store.delete(account: account)
        try? store.delete(account: pendingAccount)
        cached = nil
        pending = nil
        loaded = true
    }

    public enum AuthError: Error, LocalizedError {
        case noSignInInProgress

        public var errorDescription: String? {
            "Start with “Sign in with browser” first, then use the link or code it gives you."
        }
    }
}
