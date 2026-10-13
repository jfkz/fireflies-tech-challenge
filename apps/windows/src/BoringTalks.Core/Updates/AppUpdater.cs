namespace BoringTalks.Core.Updates;

/// <summary>A newer build on the update feed. <see cref="Handle"/> is the feed's own description of it.</summary>
public sealed record UpdateRelease(string Version, object Handle);

/// <summary>Where updates come from: Velopack in the app, a fake in tests.</summary>
public interface IUpdateFeed
{
    /// <summary>False when running from a build folder rather than the installed app: nothing to update.</summary>
    bool IsInstalled { get; }

    /// <summary>The newer build, or null when this one is the latest.</summary>
    Task<UpdateRelease?> CheckAsync(CancellationToken cancellation);

    Task DownloadAsync(UpdateRelease release, Action<int> percent, CancellationToken cancellation);

    /// <summary>Installs the downloaded build once this process has exited, then starts it again if <paramref name="restart"/>.</summary>
    void ApplyAfterExit(UpdateRelease release, bool restart);
}

public abstract record UpdateState
{
    private UpdateState() { }

    /// <summary>Not the installed app (a developer build): updates are off.</summary>
    public sealed record Unavailable : UpdateState;

    public sealed record Idle : UpdateState;

    public sealed record Checking : UpdateState;

    public sealed record UpToDate(DateTimeOffset CheckedAt) : UpdateState;

    public sealed record Downloading(string Version, int Percent) : UpdateState;

    /// <summary>Downloaded: installed when the app restarts or quits.</summary>
    public sealed record Ready(string Version) : UpdateState;

    public sealed record Failed(string Reason) : UpdateState;
}

/// <summary>What Settings says about updates.</summary>
public static class UpdateText
{
    public static string Describe(UpdateState state, TimeZoneInfo? zone = null) => state switch
    {
        UpdateState.Unavailable => "Updates come with the installed app; this build doesn't update itself.",
        UpdateState.Checking => "Checking for updates…",
        UpdateState.UpToDate up => $"Up to date. Checked at {TimeZoneInfo.ConvertTime(up.CheckedAt, zone ?? TimeZoneInfo.Local):HH:mm}.",
        UpdateState.Downloading d => $"Downloading {d.Version}… {d.Percent} %",
        UpdateState.Ready r => $"{r.Version} is ready. It installs when you restart or quit the app.",
        UpdateState.Failed f => $"Couldn't check for updates: {f.Reason}",
        _ => "Checks for updates every few hours and downloads them in the background.",
    };

    /// <summary>"Check for updates" makes sense: nothing under way, nothing waiting.</summary>
    public static bool CanCheck(UpdateState state) => state is UpdateState.Idle or UpdateState.UpToDate or UpdateState.Failed;
}

/// <summary>
/// Keeps the app up to date: checks the feed a little after launch and then every few hours,
/// downloads a newer build in the background, and installs it when the app restarts (the
/// "Restart to update" button) or quits. It never restarts the app by itself, so a meeting being
/// recorded is never cut off.
/// </summary>
public sealed class AppUpdater : IDisposable
{
    public static readonly TimeSpan FirstCheck = TimeSpan.FromSeconds(30);
    public static readonly TimeSpan Interval = TimeSpan.FromHours(4);

    private readonly IUpdateFeed feed;
    private readonly TimeProvider time;
    private readonly Action<string> log;
    private readonly CancellationTokenSource stop = new();
    private readonly SemaphoreSlim checking = new(1, 1);
    private UpdateRelease? ready;

    public AppUpdater(IUpdateFeed feed, TimeProvider? time = null, Action<string>? log = null)
    {
        this.feed = feed;
        this.time = time ?? TimeProvider.System;
        this.log = log ?? (_ => { });
        State = feed.IsInstalled ? new UpdateState.Idle() : new UpdateState.Unavailable();
    }

    public UpdateState State { get; private set; }

    /// <summary>Raised on whatever thread the change happened on.</summary>
    public event Action<UpdateState>? Changed;

    public bool IsReady => ready is not null;

    /// <summary>Checks after <see cref="FirstCheck"/>, then every <see cref="Interval"/>, until disposed.</summary>
    public Task RunAsync() => feed.IsInstalled ? LoopAsync(stop.Token) : Task.CompletedTask;

    private async Task LoopAsync(CancellationToken cancellation)
    {
        try
        {
            await Task.Delay(FirstCheck, time, cancellation);
            while (!cancellation.IsCancellationRequested)
            {
                await CheckNowAsync();
                // Once a build is waiting, there's nothing more to fetch until the app restarts.
                if (ready is not null) return;
                await Task.Delay(Interval, time, cancellation);
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    /// <summary>Checks now ("Check for updates"); downloads a newer build if there is one.</summary>
    public async Task CheckNowAsync()
    {
        if (!feed.IsInstalled || ready is not null) return;
        if (!await checking.WaitAsync(0)) return;
        try
        {
            Set(new UpdateState.Checking());
            var release = await feed.CheckAsync(stop.Token);
            if (release is null)
            {
                Set(new UpdateState.UpToDate(time.GetUtcNow()));
                return;
            }
            log($"downloading {release.Version}");
            Set(new UpdateState.Downloading(release.Version, 0));
            var last = 0;
            await feed.DownloadAsync(release, percent =>
            {
                // Whole steps of 5 %, so the menu isn't redrawn for every chunk.
                var step = Math.Clamp(percent, 0, 100) / 5 * 5;
                if (step == last) return;
                last = step;
                Set(new UpdateState.Downloading(release.Version, step));
            }, stop.Token);
            ready = release;
            log($"{release.Version} is ready");
            Set(new UpdateState.Ready(release.Version));
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception error)
        {
            // Offline, the feed is down, the download broke: try again at the next check.
            log($"update check failed: {error.Message}");
            Set(new UpdateState.Failed(error.Message));
        }
        finally
        {
            checking.Release();
        }
    }

    /// <summary>
    /// Installs the waiting build once the app exits. <paramref name="restart"/>: the "Restart to
    /// update" button (the caller then quits); otherwise the app is quitting anyway.
    /// </summary>
    /// <returns>False when no build is waiting.</returns>
    public bool ApplyOnExit(bool restart)
    {
        if (ready is null) return false;
        log($"installing {ready.Version} after exit{(restart ? ", then restarting" : "")}");
        feed.ApplyAfterExit(ready, restart);
        // Once is enough: quitting after "Restart to update" mustn't install it twice.
        ready = null;
        return true;
    }

    private void Set(UpdateState state)
    {
        State = state;
        Changed?.Invoke(state);
    }

    public void Dispose()
    {
        stop.Cancel();
        stop.Dispose();
        checking.Dispose();
    }
}
