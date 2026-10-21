namespace BoringTalks.Core;

/// <summary>
/// The longest recording the account allows (from the API's GET /me, set by an admin): a warning in
/// the last 5 minutes (half the limit when that is shorter), then stop. Times are seconds on the
/// meeting clock. Unlike the silence stop, nothing keeps it going.
/// </summary>
public sealed class RecordingLimit(double limitSeconds, double warningLead = 300)
{
    /// <summary>A meeting stops at this many seconds; 0 or less means no limit.</summary>
    public double Seconds { get; } = limitSeconds;

    public double WarningLead { get; } = Math.Min(warningLead, limitSeconds / 2);

    public bool IsOn => Seconds > 0;

    public SilenceVerdict Verdict(double elapsed)
    {
        if (!IsOn) return new SilenceVerdict.Listening();
        var left = Seconds - elapsed;
        if (left <= 0) return new SilenceVerdict.Stop();
        return left <= WarningLead ? new SilenceVerdict.Warning(left) : new SilenceVerdict.Listening();
    }

    /// <summary>"2 hours", "90 minutes", "1 hour": for messages about the limit.</summary>
    public static string Describe(double seconds)
    {
        var minutes = (int)Math.Round(seconds / 60);
        if (minutes >= 60 && minutes % 60 == 0) return minutes == 60 ? "1 hour" : $"{minutes / 60} hours";
        return minutes == 1 ? "1 minute" : $"{minutes} minutes";
    }
}
