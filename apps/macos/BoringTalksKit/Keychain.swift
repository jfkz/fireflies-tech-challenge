import Foundation
import Security

/// Where secrets go. The Keychain in the app, a dictionary in tests.
public protocol SecretStore: Sendable {
    func readData(account: String) throws -> Data?
    func write(_ data: Data, account: String) throws
    func delete(account: String) throws
}

public extension SecretStore {
    func read(account: String) throws -> String? {
        try readData(account: account).flatMap { String(data: $0, encoding: .utf8) }
    }

    func write(_ value: String, account: String) throws {
        try write(Data(value.utf8), account: account)
    }
}

public struct KeychainError: Error, Equatable, LocalizedError {
    public let status: OSStatus

    public var errorDescription: String? {
        let message = SecCopyErrorMessageString(status, nil) as String? ?? "unknown error"
        return "Keychain error \(status): \(message)"
    }
}

/// Generic passwords under one service name, in the data protection Keychain: items belong to the
/// app's Keychain access group (team ID + bundle ID), so any build signed by the team reads them
/// without asking. The file-based login keychain, which ties each item to the exact code signature
/// that made it and asks "BoringTalks wants to use your confidential information" when another
/// build reads it, is only a fallback for builds without the access-group entitlement (local and
/// ad-hoc builds; the entitlement needs the Developer ID provisioning profile).
public struct KeychainStore: SecretStore {
    public let service: String

    public init(service: String = AppFlavor.production.keychainService) {
        self.service = service
    }

    private func query(_ account: String) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if Self.usesDataProtection { query[kSecUseDataProtectionKeychain as String] = true }
        return query
    }

    public func readData(account: String) throws -> Data? {
        var query = query(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess: return result as? Data
        case errSecItemNotFound: return nil
        default: throw KeychainError(status: status)
        }
    }

    public func write(_ data: Data, account: String) throws {
        let update = [kSecValueData as String: data]
        let status = SecItemUpdate(query(account) as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var item = query(account)
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            item[kSecAttrLabel as String] = "BoringTalks device sign-in"
            let added = SecItemAdd(item as CFDictionary, nil)
            guard added == errSecSuccess else { throw KeychainError(status: added) }
        } else if status != errSecSuccess {
            throw KeychainError(status: status)
        }
    }

    public func delete(account: String) throws {
        let status = SecItemDelete(query(account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
    }

    /// Whether this build is signed with an application identifier (a Developer ID release with its
    /// provisioning profile), which is what the data protection Keychain needs. Decided once from the
    /// entitlements rather than from Keychain errors, which differ between calls without it (a read
    /// finds nothing where a write fails), so reads and writes always go to the same Keychain.
    public static let usesDataProtection: Bool = {
        guard let task = SecTaskCreateFromSelf(nil) else { return false }
        return SecTaskCopyValueForEntitlement(task, "com.apple.application-identifier" as CFString, nil) != nil
    }()
}

/// For tests and previews.
public final class InMemorySecretStore: SecretStore, @unchecked Sendable {
    private var items: [String: Data] = [:]
    private let lock = NSLock()

    public init() {}

    public func readData(account: String) throws -> Data? {
        lock.withLock { items[account] }
    }

    public func write(_ data: Data, account: String) throws {
        lock.withLock { items[account] = data }
    }

    public func delete(account: String) throws {
        _ = lock.withLock { items.removeValue(forKey: account) }
    }
}
