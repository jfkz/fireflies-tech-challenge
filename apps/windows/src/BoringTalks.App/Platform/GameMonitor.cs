using System.Diagnostics;
using System.Runtime.InteropServices;

using Microsoft.Win32;
using BoringTalks.Core.Calls;

namespace BoringTalks.App.Platform;

/// <summary>
/// Which games are running, every few seconds, for "Record when a game starts". Reads each
/// program's path with the least access Windows offers (so games behind anti-cheat still answer)
/// and asks <see cref="GameDetector"/>. Runs only while the setting is on.
/// </summary>
public sealed class GameMonitor : IDisposable
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan RecognisedRefresh = TimeSpan.FromMinutes(5);

    private readonly Dictionary<int, string?> paths = [];
    private HashSet<string> recognised = new(StringComparer.OrdinalIgnoreCase);
    private DateTime recognisedAt = DateTime.MinValue;
    private CancellationTokenSource? running;

    /// <summary>The games running now (on a background thread).</summary>
    public event Action<IReadOnlyCollection<string>>? Changed;

    public bool IsRunning => running is not null;

    public void Start()
    {
        if (running is not null) return;
        var stop = running = new CancellationTokenSource();
        var thread = new Thread(() => Watch(stop.Token)) { IsBackground = true, Name = "BoringTalks games", Priority = ThreadPriority.BelowNormal };
        thread.Start();
    }

    public void Stop()
    {
        running?.Cancel();
        running = null;
    }

    private void Watch(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                var games = Scan();
                if (!stop.IsCancellationRequested) Changed?.Invoke(games);
            }
            catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception)
            {
                Log.Error("games", "couldn't list the running programs", error);
            }
            stop.WaitHandle.WaitOne(Interval);
        }
    }

    /// <summary>The games running now (also `--games` on the command line).</summary>
    public HashSet<string> Scan()
    {
        if (DateTime.UtcNow - recognisedAt > RecognisedRefresh)
        {
            recognised = ReadRecognised();
            recognisedAt = DateTime.UtcNow;
        }
        var games = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var alive = new HashSet<int>();
        foreach (var process in Process.GetProcesses())
        {
            using (process)
            {
                alive.Add(process.Id);
                if (!paths.TryGetValue(process.Id, out var path)) paths[process.Id] = path = ImagePath(process.Id);
                if (path is not null && GameDetector.GameName(path, recognised) is { } game) games.Add(game);
            }
        }
        foreach (var gone in paths.Keys.Where(id => !alive.Contains(id)).ToList()) paths.Remove(gone);
        return games;
    }

    /// <summary>The executables Windows' Game Bar recognised as games.</summary>
    private static HashSet<string> ReadRecognised()
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var children = Registry.CurrentUser.OpenSubKey(@"System\GameConfigStore\Children");
            if (children is null) return set;
            foreach (var name in children.GetSubKeyNames())
            {
                using var child = children.OpenSubKey(name);
                if (child?.GetValue("MatchedExeFullPath") is string exe && exe.Length > 0) set.Add(exe);
            }
        }
        catch (Exception error) when (error is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
            Log.Error("games", "couldn't read Game Bar's list of games", error);
        }
        return set;
    }

    private const uint ProcessQueryLimitedInformation = 0x1000;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int processId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, [Out] char[] name, ref uint size);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    private static string? ImagePath(int processId)
    {
        var handle = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (handle == IntPtr.Zero) return null;
        try
        {
            var name = new char[1024];
            var size = (uint)name.Length;
            return QueryFullProcessImageName(handle, 0, name, ref size) ? new string(name, 0, (int)size) : null;
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    public void Dispose() => running?.Cancel();
}
