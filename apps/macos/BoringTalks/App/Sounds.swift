import AVFoundation
import BoringTalksKit

/// The start and stop chimes (`Chime`). The system-audio tap would hear anything played while it
/// runs, so the start chime ends before the recording starts and the stop chime plays after the
/// captures stopped: neither is in the recording.
@MainActor
enum Sounds {
    private static var players: [Bool: AVAudioPlayer] = [:]

    /// Plays the start chime and waits until it has finished.
    static func playStart() async {
        guard play(rising: true) else { return }
        try? await Task.sleep(for: .seconds(Chime.duration + 0.06))
    }

    static func playStop() {
        play(rising: false)
    }

    @discardableResult
    private static func play(rising: Bool) -> Bool {
        if players[rising] == nil {
            players[rising] = try? AVAudioPlayer(data: Chime.wav(rising: rising))
            _ = players[rising]?.prepareToPlay()
        }
        guard let player = players[rising] else { return false }
        player.currentTime = 0
        return player.play()
    }
}
