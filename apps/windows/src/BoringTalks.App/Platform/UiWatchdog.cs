using System.Diagnostics;
using System.Windows.Threading;
using BoringTalks.Core.Reports;

namespace BoringTalks.App.Platform;

/// <summary>
/// Posts a ping to the UI thread every second from a thread of its own. When the UI thread stops
/// running them (the menu, Stop and call detection are frozen then) the hang is logged and kept in
/// <c>last-hang.json</c> while it lasts (see <see cref="HangWatch"/>), and <see cref="Recovered"/> is
/// raised on the UI thread when it answers again.
/// </summary>
public sealed class UiWatchdog(Dispatcher ui, HangStore store, Action<string> log, double thresholdSeconds = 10)
{
    private readonly HangWatch watch = new(store, thresholdSeconds, log);

    /// <summary>On the UI thread, when a hang has ended.</summary>
    public event Action<Hang>? Recovered;

    public void Start()
    {
        var clock = Stopwatch.StartNew();
        new Thread(() =>
        {
            while (true)
            {
                if (watch.Tick(clock.Elapsed.TotalSeconds, DateTimeOffset.Now))
                {
                    ui.BeginInvoke(DispatcherPriority.Normal, () =>
                    {
                        if (watch.Answered(clock.Elapsed.TotalSeconds, DateTimeOffset.Now) is { } hang) Recovered?.Invoke(hang);
                    });
                }
                Thread.Sleep(1000);
            }
        }) { IsBackground = true, Name = "BoringTalks watchdog", Priority = ThreadPriority.AboveNormal }.Start();
    }
}
