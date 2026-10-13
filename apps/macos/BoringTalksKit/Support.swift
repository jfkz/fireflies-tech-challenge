import Foundation
import os

public extension URL {
    /// A URL written in the source. A typo there is a programmer error, caught by the
    /// first launch, so it stops with a message instead of an anonymous force unwrap.
    init(literal: StaticString) {
        guard let url = URL(string: "\(literal)") else {
            preconditionFailure("Invalid URL literal: \(literal)")
        }
        self = url
    }
}

public enum Log {
    public static let subsystem = "games.cutthecheese.boringtalks"

    public static func logger(_ category: String) -> Logger {
        Logger(subsystem: subsystem, category: category)
    }
}

/// Folders the app keeps its data in, under Application Support/BoringTalks.
public struct AppFolders: Sendable {
    public let root: URL

    public init(root: URL) {
        self.root = root
    }

    /// `~/Library/Application Support/BoringTalks`.
    public static var standard: AppFolders { standard(named: "BoringTalks") }

    /// `~/Library/Application Support/<name>`.
    public static func standard(named name: String) -> AppFolders {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        return AppFolders(root: base.appendingPathComponent(name, isDirectory: true))
    }

    public var recordings: URL { root.appendingPathComponent("Recordings", isDirectory: true) }
    public var models: URL { root.appendingPathComponent("models", isDirectory: true) }
    public var uploadQueue: URL { root.appendingPathComponent("uploads.json") }

    public func create() throws {
        for folder in [root, recordings, models] {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        }
    }
}
