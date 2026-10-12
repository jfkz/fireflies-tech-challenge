namespace BoringTalks.Core;

public abstract record SilenceVerdict
{
    public sealed record Listening : SilenceVerdict;
    /// <summary>Quiet for a while; the recording stops in <c>StopsIn</c> seconds.</summary>
    public sealed record Warning(double StopsIn) : SilenceVerdict;
    public sealed record Stop : SilenceVerdict;
}

/// <summary>
/// Decides when a meeting has gone quiet for long enough that it has probably
/// ended and the recording was left running.
/// <para>
/// Times are seconds on the meeting clock (since Start). "Activity" is the last
/// moment anyone was heard; the recorder works it out from the transcript (or the
/// level meters while the speech model is still loading). A minute before the
/// limit it warns, so someone still there can keep the recording going.
/// </para>
/// </summary>
public sealed class SilenceWatch(double limit, double warningLead = 60)
{
    /// <summary>Quiet this long stops the recording; 0 or less turns the watch off.</summary>
    public double Limit { get; } = limit;
    /// <summary>How long before the stop the warning starts.</summary>
    public double WarningLead { get; } = Math.Min(warningLead, limit / 2);
    /// <summary>"Keep recording" counts as activity at this moment.</summary>
    public double KeptAt { get; private set; }

    public bool IsOn => Limit > 0;

    /// <summary>How long it has been quiet at <paramref name="now"/>, given the last activity.</summary>
    public double Quiet(double lastActivity, double now) => Math.Max(0, now - Math.Max(Math.Max(lastActivity, KeptAt), 0));

    public SilenceVerdict Verdict(double lastActivity, double now)
    {
        if (!IsOn) return new SilenceVerdict.Listening();
        var quiet = Quiet(lastActivity, now);
        if (quiet >= Limit) return new SilenceVerdict.Stop();
        if (quiet >= Limit - WarningLead) return new SilenceVerdict.Warning(Limit - quiet);
        return new SilenceVerdict.Listening();
    }

    /// <summary>Someone is still there: start counting the quiet again from <paramref name="now"/>.</summary>
    public void KeepRecording(double now) => KeptAt = Math.Max(KeptAt, now);

    /// <summary>"5 minutes", "1 minute", "90 seconds": for messages about the limit.</summary>
    public static string Describe(double seconds)
    {
        var whole = (int)Math.Round(seconds);
        if (whole >= 60 && whole % 60 == 0)
        {
            var minutes = whole / 60;
            return minutes == 1 ? "1 minute" : $"{minutes} minutes";
        }
        return whole == 1 ? "1 second" : $"{whole} seconds";
    }
}
