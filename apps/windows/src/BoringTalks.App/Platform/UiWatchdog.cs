using System.Diagnostics;
using System.Windows.Threading;
using BoringTalks.Core;

namespace BoringTalks.App.Platform;

/// <summary>
/// Posts a ping to the UI thread every second from a thread of its own and logs when the UI thread
/// stops running them (the menu, Stop and call detection are frozen then) and when it comes back.
/// </summary>
public sealed class UiWatchdog(Dispatcher ui, Action<string> log, double thresholdSeconds = 10)
{
    private readonly HangDetector detector = new(thresholdSeconds);

    public void Start()
    {
        var clock = Stopwatch.StartNew();
        new Thread(() =>
        {
            while (true)
            {
                var (ping, hang) = detector.Tick(clock.Elapsed.TotalSeconds);
                if (hang is HangEvent.Stalled stalled) log($"the UI thread has not answered for {stalled.Seconds:0} s");
                if (ping)
                {
                    ui.BeginInvoke(DispatcherPriority.Normal, () =>
                    {
                        if (detector.Answered(clock.Elapsed.TotalSeconds) is HangEvent.Recovered recovered) log($"the UI thread was stuck for {recovered.Seconds:0} s");
                    });
                }
                Thread.Sleep(1000);
            }
        }) { IsBackground = true, Name = "BoringTalks watchdog", Priority = ThreadPriority.AboveNormal }.Start();
    }
}
