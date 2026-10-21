using System.Media;
using BoringTalks.Core.Audio;

namespace BoringTalks.App.Platform;

/// <summary>
/// The start and stop chimes (<see cref="Chime"/>). Played by BoringTalks itself, so process loopback
/// leaves them out of the recording; the start chime ends before the microphone opens and the stop
/// chime plays after it closed, so the microphone doesn't hear them either.
/// </summary>
public static class Sounds
{
    private static readonly Lazy<SoundPlayer> Start = new(() => Load(rising: true));
    private static readonly Lazy<SoundPlayer> Stop = new(() => Load(rising: false));

    /// <summary>Plays the start chime and waits until it has finished.</summary>
    public static async Task PlayStartAsync()
    {
        if (!TryPlay(Start.Value)) return;
        await Task.Delay(Chime.Duration + TimeSpan.FromMilliseconds(60));
    }

    public static void PlayStop() => TryPlay(Stop.Value);

    private static SoundPlayer Load(bool rising)
    {
        var player = new SoundPlayer(new MemoryStream(Chime.Wav(rising)));
        player.Load();
        return player;
    }

    private static bool TryPlay(SoundPlayer player)
    {
        try
        {
            player.Play();
            return true;
        }
        catch (Exception error) when (error is InvalidOperationException or TimeoutException or System.ComponentModel.Win32Exception)
        {
            Log.Error("app", "couldn't play a sound", error);
            return false;
        }
    }
}
