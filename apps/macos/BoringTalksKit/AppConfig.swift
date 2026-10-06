import Foundation

/// Where the API and the dashboard live.
///
/// Production by default. For the dev environment:
/// `defaults write games.cutthecheese.boringtalks apiURL https://api.dev.boringtalks.lol`
/// (and `webURL https://dev.boringtalks.lol`), or launch with `--api-url` / `--web-url`.
/// Launch arguments win over defaults.
public struct AppConfig: Equatable, Sendable {
    public var apiURL: URL
    public var webURL: URL

    public static let productionAPI = URL(literal: "https://api.boringtalks.lol")
    public static let productionWeb = URL(literal: "https://boringtalks.lol")

    public init(apiURL: URL = AppConfig.productionAPI, webURL: URL = AppConfig.productionWeb) {
        self.apiURL = apiURL
        self.webURL = webURL
    }

    public static func resolve(arguments: [String], defaults: UserDefaults) -> AppConfig {
        func argument(_ flag: String) -> String? {
            guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else { return nil }
            return arguments[index + 1]
        }
        func url(_ text: String?) -> URL? {
            guard let text, let url = URL(string: text.trimmingCharacters(in: .whitespaces)),
                  let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http", url.host != nil else { return nil }
            return url
        }
        return AppConfig(
            apiURL: url(argument("--api-url")) ?? url(defaults.string(forKey: "apiURL")) ?? productionAPI,
            webURL: url(argument("--web-url")) ?? url(defaults.string(forKey: "webURL")) ?? productionWeb
        )
    }

    /// The dashboard page of a meeting.
    public func meetingURL(id: String) -> URL {
        webURL.appendingPathComponent("meetings").appendingPathComponent(id)
    }

    public var isProduction: Bool { apiURL == Self.productionAPI }
}
