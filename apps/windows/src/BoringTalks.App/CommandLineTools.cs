using System.Diagnostics;
using System.Text.Json;
using BoringTalks.App.Audio;
using BoringTalks.App.Platform;
using BoringTalks.App.Recording;
using BoringTalks.Core;
using BoringTalks.Core.Calls;

namespace BoringTalks.App;

/// <summary>Flags that do one job and exit instead of starting the tray app.</summary>
public static class CommandLineTools
{
    /// <summary>The exit code of the tool that ran, or null when no tool was asked for.</summary>
    public static int? Run(string[] arguments)
    {
        string? Value(string flag)
        {
            var index = Array.FindIndex(arguments, a => a.Equals(flag, StringComparison.OrdinalIgnoreCase));
            return index >= 0 && index + 1 < arguments.Length ? arguments[index + 1] : null;
        }
        bool Has(string flag) => arguments.Contains(flag, StringComparer.OrdinalIgnoreCase);

        if (Has("--listen-test"))
        {
            ConsoleOutput.Attach();
            return ListenTest(double.TryParse(Value("--listen-test"), out var s) ? s : 6);
        }
        if (Has("--mic-users"))
        {
            ConsoleOutput.Attach();
            var settings = new JsonSettingsStore(AppFolders.Standard.Settings).Load();
            return MicUsers(double.TryParse(Value("--mic-users"), out var s) ? s : 30, settings.ExtraCallApps);
        }
        if (FileTranscriber.Options.Parse(arguments) is { } options)
        {
            ConsoleOutput.Attach();
            return FileTranscriber.RunAsync(options).GetAwaiter().GetResult();
        }
        return null;
    }

    /// <summary><c>--listen-test [seconds]</c>: how much system audio arrives, at which rate, and how loud.</summary>
    private static int ListenTest(double seconds)
    {
        using var capture = new SystemAudioCapture(ConsoleOutput.Status);
        var gate = new Lock();
        int chunks = 0, rate = 0;
        long frames = 0, converted = 0;
        float peak = 0;
        var to16k = new To16k();
        capture.Audio += audio =>
        {
            var samples = to16k.Convert(audio);
            lock (gate)
            {
                chunks++;
                frames += audio.Samples.Length;
                converted += samples.Length;
                rate = audio.SampleRate;
                peak = Math.Max(peak, audio.Samples.Length == 0 ? 0 : audio.Samples.Max(Math.Abs));
            }
        };
        try
        {
            capture.Start();
        }
        catch (CaptureException error)
        {
            ConsoleOutput.Status($"capture failed: {error.Message}");
            return 1;
        }
        Thread.Sleep(TimeSpan.FromSeconds(seconds));
        capture.Stop();
        lock (gate)
        {
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                seconds,
                source = capture.DeviceName,
                allOutputDevices = capture.AllDevices,
                captureSampleRate = rate,
                chunks,
                framesPerSecond = frames / seconds,
                converted16kPerSecond = converted / seconds,
                peak,
            }, new JsonSerializerOptions { WriteIndented = true }));
        }
        return 0;
    }

    /// <summary><c>--mic-users [seconds]</c>: the apps using a microphone whenever that changes, and which call app each counts as.</summary>
    private static int MicUsers(double seconds, IReadOnlyCollection<string> extra)
    {
        using var monitor = new MicUsageMonitor();
        void Print()
        {
            var users = monitor.Users.Select(id => $"{id} → {CallApps.Identify(id, extra)?.Name ?? "not a call app"}").ToList();
            Console.WriteLine($"{DateTime.Now:HH:mm:ss} {(users.Count == 0 ? "nobody is using a microphone" : string.Join(", ", users))}");
        }
        monitor.Changed += Print;
        monitor.Start();
        if (monitor.Users.Count == 0) Print();
        var clock = Stopwatch.StartNew();
        while (clock.Elapsed.TotalSeconds < seconds) Thread.Sleep(200);
        return 0;
    }
}
