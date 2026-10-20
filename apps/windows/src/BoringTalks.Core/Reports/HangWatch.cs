namespace BoringTalks.Core.Reports;

/// <summary>
/// What the watchdog makes of its pings (see <see cref="HangDetector"/>): a hang is logged once,
/// saved to the <see cref="HangStore"/> while it lasts (every 5 s, in case the app is killed), and
/// handed back, recovered, when the UI thread answers again. <paramref name="threshold"/> seconds
/// without an answer is a hang.
/// </summary>
public sealed class HangWatch(HangStore store, double threshold = 10, Action<string>? log = null)
{
    private readonly HangDetector detector = new(threshold);
    private readonly Lock gate = new();
    private Hang? current;
    private double savedAt;

    /// <summary>On the watchdog's thread every second. True: post a ping to the UI thread.</summary>
    /// <param name="now">Seconds on a monotonic clock.</param>
    public bool Tick(double now, DateTimeOffset wallClock)
    {
        lock (gate)
        {
            var (ping, hang) = detector.Tick(now);
            if (hang is not HangEvent.Stalled stalled) return ping;
            if (current is null)
            {
                current = new Hang(wallClock - TimeSpan.FromSeconds(stalled.Seconds), stalled.Seconds, Recovered: false);
                log?.Invoke($"the UI thread has not answered for {stalled.Seconds:0} s");
            }
            else if (now - savedAt < 5)
            {
                return ping;
            }
            current = current with { Seconds = stalled.Seconds };
            store.Save(current);
            savedAt = now;
            return ping;
        }
    }

    /// <summary>On the UI thread, running the ping. The hang that just ended, if it was one.</summary>
    public Hang? Answered(double now, DateTimeOffset wallClock)
    {
        lock (gate)
        {
            if (detector.Answered(now) is not HangEvent.Recovered recovered) return null;
            var hang = (current ?? new Hang(wallClock - TimeSpan.FromSeconds(recovered.Seconds), recovered.Seconds, Recovered: false))
                with { Seconds = recovered.Seconds, Recovered = true };
            current = null;
            store.Save(hang);
            log?.Invoke($"the UI thread was stuck for {recovered.Seconds:0} s");
            return hang;
        }
    }
}
