using BoringTalks.Core.Updates;
using Velopack;

namespace BoringTalks.App.Platform;

/// <summary>
/// The update feed on download.boringtalks.lol (<c>releases.win.json</c> and the full package,
/// published by <c>scripts/publish.ps1</c>), through Velopack, which also installed the app.
/// </summary>
public sealed class VelopackFeed : IUpdateFeed
{
    private readonly UpdateManager? manager;

    public VelopackFeed(Uri feed)
    {
        try
        {
            manager = new UpdateManager(feed.ToString());
        }
        catch (Exception error)
        {
            // A damaged install: run without updates rather than not at all.
            Log.Error("updates", "couldn't set up updates", error);
        }
    }

    public bool IsInstalled => manager is { IsInstalled: true, IsPortable: false };

    public async Task<UpdateRelease?> CheckAsync(CancellationToken cancellation)
    {
        var info = await Manager.CheckForUpdatesAsync().WaitAsync(cancellation);
        return info is null ? null : new UpdateRelease(info.TargetFullRelease.Version.ToString(), info);
    }

    public Task DownloadAsync(UpdateRelease release, Action<int> percent, CancellationToken cancellation) =>
        Manager.DownloadUpdatesAsync((UpdateInfo)release.Handle, percent, cancellation);

    /// <summary>
    /// Velopack's updater waits for this process to exit, installs quietly, and starts the new build in
    /// the tray (<c>--after-update</c>: it waits for this one to let go of the single-instance lock).
    /// </summary>
    public void ApplyAfterExit(UpdateRelease release, bool restart) =>
        Manager.WaitExitThenApplyUpdates(((UpdateInfo)release.Handle).TargetFullRelease, silent: true, restart: restart, restartArgs: ["--background", "--after-update"]);

    private UpdateManager Manager => manager ?? throw new InvalidOperationException("Updates aren't set up.");
}
