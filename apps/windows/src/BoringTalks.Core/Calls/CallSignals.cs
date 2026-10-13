namespace BoringTalks.Core.Calls;

/// <summary>An app that holds calls, recognized by the process (or packaged app) using the microphone.</summary>
/// <param name="Name">What the user calls it ("Zoom", "Chrome"); several processes map to one name.</param>
/// <param name="IsBrowser">Browsers also open the microphone for voice notes and dictation, so they wait longer.</param>
public sealed record CallApp(string Name, bool IsBrowser);

public static class CallApps
{
    /// <summary>Executable names (lower case) of desktop call apps and browsers.</summary>
    internal static readonly Dictionary<string, CallApp> Executables = new(StringComparer.OrdinalIgnoreCase)
    {
        ["zoom.exe"] = new("Zoom", false),
        ["ms-teams.exe"] = new("Teams", false),
        ["teams.exe"] = new("Teams", false),
        ["ciscocollabhost.exe"] = new("Webex", false),
        ["webex.exe"] = new("Webex", false),
        ["atmgr.exe"] = new("Webex", false),
        ["slack.exe"] = new("Slack", false),
        ["discord.exe"] = new("Discord", false),
        ["whatsapp.exe"] = new("WhatsApp", false),
        ["telegram.exe"] = new("Telegram", false),
        ["skype.exe"] = new("Skype", false),
        ["chrome.exe"] = new("Chrome", true),
        ["msedge.exe"] = new("Edge", true),
        ["firefox.exe"] = new("Firefox", true),
        ["brave.exe"] = new("Brave", true),
        ["opera.exe"] = new("Opera", true),
        ["vivaldi.exe"] = new("Vivaldi", true),
        ["arc.exe"] = new("Arc", true),
    };

    /// <summary>Package family name prefixes of Store apps (they show up by package, not by file).</summary>
    internal static readonly (string Prefix, CallApp App)[] Packages =
    [
        ("MSTeams_", new("Teams", false)),
        ("MicrosoftTeams_", new("Teams", false)),
        ("Microsoft.SkypeApp_", new("Skype", false)),
        ("91750D7E.Slack_", new("Slack", false)),
        ("5319275A.WhatsAppDesktop_", new("WhatsApp", false)),
        ("TelegramMessengerLLP.TelegramDesktop_", new("Telegram", false)),
        ("Zoom.Zoom_", new("Zoom", false)),
        ("TheBrowserCompany.Arc_", new("Arc", true)),
    ];

    /// <summary>
    /// The call app behind a microphone user, or null for anything else (dictation, a
    /// voice recorder…). <paramref name="identity"/> is an executable path or file name, or a
    /// package family name. <paramref name="extra"/> are executable names added by hand
    /// (<c>extraCallApps</c> in settings.json).
    /// </summary>
    public static CallApp? Identify(string identity, IReadOnlyCollection<string>? extra = null)
    {
        if (string.IsNullOrWhiteSpace(identity)) return null;
        var file = Path.GetFileName(identity.Replace('/', '\\').TrimEnd('\\'));
        if (Executables.TryGetValue(file, out var app)) return app;
        foreach (var (prefix, packaged) in Packages)
        {
            if (identity.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return packaged;
        }
        var added = extra?.FirstOrDefault(e => e.Length > 0 && (e.Equals(file, StringComparison.OrdinalIgnoreCase) || identity.StartsWith(e, StringComparison.OrdinalIgnoreCase)));
        if (added is null) return null;
        // Named as the file is spelled on disk ("Huddle"), else as it was added.
        return new CallApp(added.Equals(file, StringComparison.OrdinalIgnoreCase) && file.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? Path.GetFileNameWithoutExtension(file) : added, false);
    }
}

public abstract record CallEvent(string App)
{
    /// <summary><c>App</c> has held the microphone long enough to be a call: ask to record it.</summary>
    public sealed record Offer(string App) : CallEvent(App);
    /// <summary>The app offered for released the microphone before anyone answered.</summary>
    public sealed record Withdraw(string App) : CallEvent(App);
    /// <summary>The app of the call being recorded released the microphone.</summary>
    public sealed record Ended(string App) : CallEvent(App);
    /// <summary>…and took it back (a device switch, a reconnect).</summary>
    public sealed record Resumed(string App) : CallEvent(App);
}

/// <summary>
/// Turns "which call apps have the microphone open" into what the app should do:
/// offer to record a call that has started, and notice when the recorded call ends.
/// <para>Fed every couple of seconds with the apps using the mic. Times are seconds on any monotonic clock.</para>
/// </summary>
public sealed class CallSignals(double appDelay = 5, double browserDelay = 15)
{
    private readonly Dictionary<string, double> since = new(StringComparer.Ordinal);
    private readonly Dictionary<string, CallApp> apps = new(StringComparer.Ordinal);
    /// <summary>Asked about during this call (until the app releases the mic).</summary>
    private readonly HashSet<string> asked = new(StringComparer.Ordinal);
    private bool callAppGone;

    public bool OffersEnabled { get; set; } = true;
    /// <summary>App names the user said never to ask about.</summary>
    public IReadOnlySet<string> Ignored { get; set; } = new HashSet<string>();
    /// <summary>The offer waiting for an answer.</summary>
    public string? PendingOffer { get; private set; }
    /// <summary>The app whose call is being recorded.</summary>
    public string? CallApp { get; private set; }

    public IReadOnlyList<CallEvent> Update(IEnumerable<CallApp> active, double now, bool isRecording)
    {
        var events = new List<CallEvent>();
        var current = new Dictionary<string, CallApp>(StringComparer.Ordinal);
        foreach (var app in active) current.TryAdd(app.Name, app);

        foreach (var name in since.Keys.Order(StringComparer.Ordinal).ToList())
        {
            if (current.ContainsKey(name)) continue;
            since.Remove(name);
            apps.Remove(name);
            asked.Remove(name);
            if (PendingOffer == name)
            {
                PendingOffer = null;
                events.Add(new CallEvent.Withdraw(name));
            }
            if (CallApp == name && !callAppGone)
            {
                callAppGone = true;
                events.Add(new CallEvent.Ended(name));
            }
        }
        foreach (var (name, app) in current.OrderBy(p => p.Key, StringComparer.Ordinal))
        {
            if (since.ContainsKey(name)) continue;
            since[name] = now;
            apps[name] = app;
            if (CallApp == name && callAppGone)
            {
                callAppGone = false;
                events.Add(new CallEvent.Resumed(name));
            }
        }

        var settled = SettledApps(now);
        if (isRecording)
        {
            CallApp ??= settled.FirstOrDefault();
        }
        else if (OffersEnabled && PendingOffer is null && settled.FirstOrDefault(a => !asked.Contains(a) && !Ignored.Contains(a)) is { } offer)
        {
            // One question per call, even when a browser holds the mic alongside the call app.
            asked.UnionWith(settled);
            PendingOffer = offer;
            events.Add(new CallEvent.Offer(offer));
        }
        return events;
    }

    /// <summary>Recording began (from the offer or by hand): it belongs to the call holding the mic.</summary>
    public void RecordingStarted(double now)
    {
        PendingOffer = null;
        CallApp = SettledApps(now).FirstOrDefault();
        callAppGone = false;
    }

    /// <summary>Stopped by hand or by itself: a call still holding the mic isn't offered again.</summary>
    public void RecordingStopped()
    {
        CallApp = null;
        callAppGone = false;
        asked.UnionWith(since.Keys);
    }

    /// <summary>"Not now": don't ask again until that app releases the mic.</summary>
    public void DeclineOffer() => PendingOffer = null;

    /// <summary>Apps holding the mic for at least their delay: call apps before browsers, then longest first.</summary>
    private List<string> SettledApps(double now)
    {
        bool IsBrowser(string name) => apps.TryGetValue(name, out var app) && app.IsBrowser;
        return [.. since
            .Where(p => now - p.Value >= (IsBrowser(p.Key) ? browserDelay : appDelay))
            .OrderBy(p => IsBrowser(p.Key))
            .ThenBy(p => p.Value)
            .ThenBy(p => p.Key, StringComparer.Ordinal)
            .Select(p => p.Key)];
    }
}

public abstract record CallEndVerdict
{
    public sealed record Recording : CallEndVerdict;
    public sealed record Stopping(double StopsIn) : CallEndVerdict;
    public sealed record Stop : CallEndVerdict;
}

/// <summary>
/// After the recorded call's app hangs up, stops the meeting once the other side has
/// been quiet for <c>grace</c> seconds: long enough to ride out a reconnect, short enough
/// not to leave a finished call recording. "Keep recording" or the app taking the mic
/// back cancels it.
/// </summary>
public sealed class CallEndWatch(double grace = 30)
{
    public double Grace { get; } = grace;
    public double? EndedAt { get; private set; }

    public void CallEnded(double now) => EndedAt ??= now;

    public void Cancel() => EndedAt = null;

    /// <param name="lastOthers">When someone on the other side was last heard.</param>
    public CallEndVerdict Verdict(double lastOthers, double now)
    {
        if (EndedAt is not { } ended) return new CallEndVerdict.Recording();
        var quiet = now - Math.Max(ended, lastOthers);
        return quiet >= Grace ? new CallEndVerdict.Stop() : new CallEndVerdict.Stopping(Grace - Math.Max(0, quiet));
    }
}
