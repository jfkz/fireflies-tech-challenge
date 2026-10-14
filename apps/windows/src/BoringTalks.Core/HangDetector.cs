namespace BoringTalks.Core;

public abstract record HangEvent
{
    /// <summary>The ping sent at <c>Since</c> has been waiting <c>Seconds</c>: the UI thread is stuck.</summary>
    public sealed record Stalled(double Since, double Seconds) : HangEvent;
    /// <summary>The UI thread answered after <c>Seconds</c>.</summary>
    public sealed record Recovered(double Seconds) : HangEvent;
}

/// <summary>
/// Pings to the UI thread and their answers, as on the Mac. Times are seconds on a monotonic
/// clock. A watchdog thread calls <see cref="Tick"/> every second; the UI thread calls
/// <see cref="Answered"/> when it runs the ping. A gap between ticks longer than
/// <see cref="MaxTickGap"/> is the PC sleeping (the watchdog stood still too) and doesn't count.
/// </summary>
public sealed class HangDetector(double threshold)
{
    private readonly Lock gate = new();
    /// <summary>When the ping still waiting for an answer was sent.</summary>
    private double? outstanding;
    private double? lastTick;
    private bool reported;

    public const double MaxTickGap = 5;

    public double Threshold { get; } = threshold;

    /// <summary>
    /// Sends a ping when none is waiting; otherwise says, once per hang, that the waiting one is late.
    /// </summary>
    public (bool Ping, HangEvent? Event) Tick(double now)
    {
        lock (gate)
        {
            if (lastTick is { } last && now - last > MaxTickGap && outstanding is { } asleep) outstanding = asleep + (now - last);
            lastTick = now;
            if (outstanding is not { } sent)
            {
                outstanding = now;
                reported = false;
                return (true, null);
            }
            var waited = now - sent;
            if (waited < Threshold || reported) return (false, null);
            reported = true;
            return (false, new HangEvent.Stalled(sent, waited));
        }
    }

    /// <summary>The UI thread ran the ping.</summary>
    public HangEvent? Answered(double now)
    {
        lock (gate)
        {
            if (outstanding is not { } sent) return null;
            outstanding = null;
            var waited = now - sent;
            return waited >= Threshold ? new HangEvent.Recovered(waited) : null;
        }
    }
}
