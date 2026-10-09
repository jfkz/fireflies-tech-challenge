import Foundation

/// Waiting on work that may never come back (Core Audio can block for minutes when a device
/// goes away mid-call) without being stuck with it.
public enum Deadline {
    /// The task's result, or nil when it isn't done within `limit`. The task keeps running;
    /// await it again to pick up a late result.
    public static func value<T: Sendable>(of task: Task<T, Never>, within limit: Duration) async -> T? {
        await withTaskGroup(of: T?.self) { group in
            group.addTask { await task.value }
            group.addTask {
                try? await Task.sleep(for: limit)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }
}

/// A serial queue for calls that can block for a long time, so they never run on the main thread
/// and stay in the order they were made (a stop before the next start).
public final class BlockingQueue: Sendable {
    private let queue: DispatchQueue

    public init(label: String) {
        queue = DispatchQueue(label: label, qos: .userInitiated)
    }

    /// Runs `work` on the queue and waits for it (suspending, not blocking).
    public func run<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { continuation.resume(with: Result { try work() }) }
        }
    }

    /// Runs `work` on the queue without waiting for it.
    public func enqueue(_ work: @escaping @Sendable () -> Void) {
        queue.async(execute: work)
    }
}
