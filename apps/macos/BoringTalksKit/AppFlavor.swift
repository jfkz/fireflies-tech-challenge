import Foundation

/// Which app this is: the release app, or "BoringTalks Dev", a separate app that talks to the
/// dev environment. The two can be installed side by side: each has its own bundle ID, sign-in
/// link scheme, Keychain items and data folder. Read from `BTFlavor` in Info.plist.
public enum AppFlavor: String, Sendable, CaseIterable {
    case production
    case dev

    public static let infoKey = "BTFlavor"

    public static func of(_ bundle: Bundle) -> AppFlavor {
        of(info: bundle.object(forInfoDictionaryKey: infoKey) as? String)
    }

    /// Anything but "dev" is the release app.
    public static func of(info value: String?) -> AppFlavor {
        value.flatMap { AppFlavor(rawValue: $0.lowercased()) } ?? .production
    }

    /// Where the app connects unless `apiURL` / `webURL` say otherwise.
    public var defaultConfig: AppConfig {
        switch self {
        case .production: AppConfig()
        case .dev: AppConfig(apiURL: AppConfig.devAPI, webURL: AppConfig.devWeb)
        }
    }

    /// The URL scheme the dashboard sends the sign-in code back on.
    public var callbackScheme: String {
        switch self {
        case .production: "boringtalks"
        case .dev: "boringtalks-dev"
        }
    }

    /// The app's name, as in the menu and the data folder.
    public var displayName: String {
        switch self {
        case .production: "BoringTalks"
        case .dev: "BoringTalks Dev"
        }
    }

    /// The Keychain service its sign-in is stored under.
    public var keychainService: String {
        switch self {
        case .production: "games.cutthecheese.boringtalks"
        case .dev: "games.cutthecheese.boringtalks.dev"
        }
    }

    /// `~/Library/Application Support/BoringTalks` (or `BoringTalks Dev`).
    public var folders: AppFolders {
        AppFolders.standard(named: displayName)
    }
}
