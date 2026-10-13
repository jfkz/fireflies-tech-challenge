using BoringTalks.Core;
using BoringTalks.Core.Updates;
using Microsoft.Extensions.Time.Testing;

namespace BoringTalks.Core.Tests;

public sealed class AppUpdaterTests
{
    private sealed class FakeFeed : IUpdateFeed
    {
        public bool IsInstalled { get; init; } = true;
        public UpdateRelease? Newer { get; set; }
        public Exception? Failure { get; set; }
        public int Checks { get; private set; }
        public List<UpdateRelease> Downloaded { get; } = [];
        public List<(UpdateRelease Release, bool Restart)> Applied { get; } = [];
        public TaskCompletionSource? HoldDownload { get; set; }

        public Task<UpdateRelease?> CheckAsync(CancellationToken cancellation)
        {
            Checks++;
            return Failure is { } failure ? Task.FromException<UpdateRelease?>(failure) : Task.FromResult(Newer);
        }

        public async Task DownloadAsync(UpdateRelease release, Action<int> percent, CancellationToken cancellation)
        {
            foreach (var p in new[] { 1, 3, 12, 14, 50, 100 }) percent(p);
            if (HoldDownload is { } hold) await hold.Task;
            Downloaded.Add(release);
        }

        public void ApplyAfterExit(UpdateRelease release, bool restart) => Applied.Add((release, restart));
    }

    [Fact]
    public async Task A_developer_build_never_checks()
    {
        var feed = new FakeFeed { IsInstalled = false, Newer = new("9.9.9", "x") };
        using var updater = new AppUpdater(feed);
        Assert.IsType<UpdateState.Unavailable>(updater.State);
        await updater.RunAsync();
        await updater.CheckNowAsync();
        Assert.Equal(0, feed.Checks);
        Assert.False(updater.ApplyOnExit(restart: true));
    }

    [Fact]
    public async Task Up_to_date()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2026, 10, 14, 9, 0, 0, TimeSpan.Zero));
        var feed = new FakeFeed();
        using var updater = new AppUpdater(feed, time);
        Assert.IsType<UpdateState.Idle>(updater.State);
        await updater.CheckNowAsync();
        Assert.Equal(new UpdateState.UpToDate(time.GetUtcNow()), updater.State);
        Assert.False(updater.IsReady);
        Assert.False(updater.ApplyOnExit(restart: false));
        Assert.Empty(feed.Applied);
    }

    [Fact]
    public async Task Downloads_a_newer_build_reporting_progress_in_steps_then_waits_for_a_restart()
    {
        var feed = new FakeFeed { Newer = new("0.5.1", "handle") };
        using var updater = new AppUpdater(feed);
        var states = new List<UpdateState>();
        updater.Changed += states.Add;
        await updater.CheckNowAsync();

        Assert.Equal(
            [new UpdateState.Checking(), new UpdateState.Downloading("0.5.1", 0), new UpdateState.Downloading("0.5.1", 10), new UpdateState.Downloading("0.5.1", 50),
             new UpdateState.Downloading("0.5.1", 100), new UpdateState.Ready("0.5.1")],
            states);
        Assert.True(updater.IsReady);
        Assert.Equal([feed.Newer], feed.Downloaded);

        // Already waiting: another check fetches nothing.
        await updater.CheckNowAsync();
        Assert.Equal(1, feed.Checks);

        Assert.True(updater.ApplyOnExit(restart: true));
        Assert.Equal([(feed.Newer, true)], feed.Applied);
        // Quitting afterwards doesn't install it a second time.
        Assert.False(updater.ApplyOnExit(restart: false));
        Assert.Single(feed.Applied);
    }

    [Fact]
    public async Task A_failed_check_says_why_and_the_next_one_tries_again()
    {
        var feed = new FakeFeed { Failure = new HttpRequestException("No such host is known.") };
        using var updater = new AppUpdater(feed);
        await updater.CheckNowAsync();
        Assert.Equal(new UpdateState.Failed("No such host is known."), updater.State);

        feed.Failure = null;
        feed.Newer = new("0.5.1", "h");
        await updater.CheckNowAsync();
        Assert.Equal(new UpdateState.Ready("0.5.1"), updater.State);
    }

    [Fact]
    public async Task One_check_at_a_time()
    {
        var feed = new FakeFeed { Newer = new("0.5.1", "h"), HoldDownload = new TaskCompletionSource() };
        using var updater = new AppUpdater(feed);
        var first = updater.CheckNowAsync();
        await updater.CheckNowAsync();
        Assert.Equal(1, feed.Checks);
        feed.HoldDownload.SetResult();
        await first;
        Assert.True(updater.IsReady);
    }

    [Fact]
    public async Task Checks_after_launch_then_every_few_hours_until_a_build_is_ready()
    {
        var time = new FakeTimeProvider();
        var feed = new FakeFeed();
        using var updater = new AppUpdater(feed, time);
        var run = updater.RunAsync();

        time.Advance(AppUpdater.FirstCheck - TimeSpan.FromSeconds(1));
        Assert.Equal(0, feed.Checks);
        time.Advance(TimeSpan.FromSeconds(1));
        await WaitFor(() => feed.Checks == 1);

        time.Advance(AppUpdater.Interval);
        await WaitFor(() => feed.Checks == 2);

        feed.Newer = new("0.5.1", "h");
        time.Advance(AppUpdater.Interval);
        await run.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        Assert.Equal(3, feed.Checks);
        Assert.True(updater.IsReady);
    }

    [Fact]
    public async Task Disposing_stops_the_checks()
    {
        var time = new FakeTimeProvider();
        var feed = new FakeFeed();
        var updater = new AppUpdater(feed, time);
        var run = updater.RunAsync();
        updater.Dispose();
        await run.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        time.Advance(AppUpdater.Interval);
        Assert.Equal(0, feed.Checks);
    }

    [Fact]
    public void What_settings_says()
    {
        var utc = TimeZoneInfo.Utc;
        Assert.Equal("Checks for updates every few hours and downloads them in the background.", UpdateText.Describe(new UpdateState.Idle(), utc));
        Assert.Equal("Checking for updates…", UpdateText.Describe(new UpdateState.Checking(), utc));
        Assert.Equal("Up to date. Checked at 09:05.", UpdateText.Describe(new UpdateState.UpToDate(new DateTimeOffset(2026, 10, 14, 9, 5, 0, TimeSpan.Zero)), utc));
        Assert.Equal("Downloading 0.5.1… 40 %", UpdateText.Describe(new UpdateState.Downloading("0.5.1", 40), utc));
        Assert.Equal("0.5.1 is ready. It installs when you restart or quit the app.", UpdateText.Describe(new UpdateState.Ready("0.5.1"), utc));
        Assert.Equal("Couldn't check for updates: offline", UpdateText.Describe(new UpdateState.Failed("offline"), utc));
        Assert.StartsWith("Updates come with the installed app", UpdateText.Describe(new UpdateState.Unavailable(), utc));
        Assert.StartsWith("Up to date.", UpdateText.Describe(new UpdateState.UpToDate(DateTimeOffset.UtcNow)));

        Assert.True(UpdateText.CanCheck(new UpdateState.Idle()));
        Assert.True(UpdateText.CanCheck(new UpdateState.UpToDate(DateTimeOffset.UtcNow)));
        Assert.True(UpdateText.CanCheck(new UpdateState.Failed("x")));
        Assert.False(UpdateText.CanCheck(new UpdateState.Checking()));
        Assert.False(UpdateText.CanCheck(new UpdateState.Downloading("1", 0)));
        Assert.False(UpdateText.CanCheck(new UpdateState.Ready("1")));
        Assert.False(UpdateText.CanCheck(new UpdateState.Unavailable()));
    }

    [Fact]
    public void Each_build_has_its_own_feed()
    {
        Assert.Equal("https://download.boringtalks.lol/updates/windows/", AppFlavor.Release.UpdateFeed.ToString());
        Assert.Equal("https://download.boringtalks.lol/dev/updates/windows/", AppFlavor.Dev.UpdateFeed.ToString());
    }

    private static async Task WaitFor(Func<bool> condition)
    {
        for (var i = 0; i < 200 && !condition(); i++) await Task.Delay(10);
        Assert.True(condition());
        // Let the loop get back to its next delay before the clock moves on.
        await Task.Delay(50);
    }
}
