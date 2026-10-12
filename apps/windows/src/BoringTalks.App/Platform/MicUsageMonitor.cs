using System.Runtime.InteropServices;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;
using BoringTalks.Core.Calls;

namespace BoringTalks.App.Platform;

/// <summary>
/// Which apps are using a microphone, from Windows' microphone privacy records (the data
/// behind the taskbar's microphone icon); see <see cref="MicrophoneConsentStore"/>. It sees
/// which app uses the microphone, never what it hears. Woken by registry change notifications,
/// with a re-read every couple of seconds as a safety net.
/// </summary>
public sealed class MicUsageMonitor : IDisposable
{
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern int RegNotifyChangeKeyValue(SafeRegistryHandle key, bool watchSubtree, int filter, SafeWaitHandle changeEvent, bool asynchronous);

    private const int NotifyChangeLastSet = 0x4;
    private const int NotifyChangeName = 0x1;

    private readonly string self = Environment.ProcessPath ?? "";
    private readonly CancellationTokenSource cancel = new();
    private readonly Lock gate = new();
    private IReadOnlyList<string> users = [];
    private Thread? thread;

    /// <summary>Raised (on a background thread) when the set of apps using a microphone changes.</summary>
    public event Action? Changed;

    /// <summary>Executable paths (desktop apps) or package family names (Store apps) holding a microphone now.</summary>
    public IReadOnlyList<string> Users
    {
        get { lock (gate) return users; }
    }

    public void Start()
    {
        if (thread is not null) return;
        Refresh();
        thread = new Thread(Watch) { IsBackground = true, Name = "BoringTalks microphone users" };
        thread.Start();
    }

    /// <summary>Reads the records again now.</summary>
    public void Refresh()
    {
        var now = Read();
        bool changed;
        lock (gate)
        {
            changed = !now.SequenceEqual(users, StringComparer.OrdinalIgnoreCase);
            users = now;
        }
        if (changed) Changed?.Invoke();
    }

    private IReadOnlyList<string> Read()
    {
        try
        {
            using var root = Registry.CurrentUser.OpenSubKey(MicrophoneConsentStore.KeyPath);
            if (root is null) return [];
            var entries = new List<MicrophoneConsentStore.Entry>();
            foreach (var name in root.GetSubKeyNames())
            {
                if (name == MicrophoneConsentStore.NonPackaged)
                {
                    using var desktop = root.OpenSubKey(name);
                    foreach (var app in desktop?.GetSubKeyNames() ?? []) entries.Add(EntryOf(desktop!, app, packaged: false));
                }
                else
                {
                    entries.Add(EntryOf(root, name, packaged: true));
                }
            }
            var boot = DateTime.UtcNow.AddMilliseconds(-Environment.TickCount64).ToFileTimeUtc();
            var running = RunningExecutables();
            return MicrophoneConsentStore.InUse(entries, self, boot, running.Contains);
        }
        catch (Exception error) when (error is System.Security.SecurityException or IOException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    /// <summary>Paths of running programs (those this user may see), to skip records left by apps that crashed mid-call.</summary>
    private static HashSet<string> RunningExecutables()
    {
        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var process in System.Diagnostics.Process.GetProcesses())
        {
            try
            {
                if (process.MainModule?.FileName is { } path) paths.Add(path);
            }
            catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
            {
                // Another user's or a protected process.
            }
            finally
            {
                process.Dispose();
            }
        }
        return paths;
    }

    private static MicrophoneConsentStore.Entry EntryOf(RegistryKey parent, string name, bool packaged)
    {
        using var key = parent.OpenSubKey(name);
        static long Read(RegistryKey? k, string value) => k?.GetValue(value) is long v ? v : 0;
        return new MicrophoneConsentStore.Entry(name, packaged, Read(key, "LastUsedTimeStart"), Read(key, "LastUsedTimeStop"));
    }

    private void Watch()
    {
        using var changed = new AutoResetEvent(false);
        while (!cancel.IsCancellationRequested)
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(MicrophoneConsentStore.KeyPath);
                var watching = key is not null && RegNotifyChangeKeyValue(key.Handle, true, NotifyChangeLastSet | NotifyChangeName, changed.SafeWaitHandle, true) == 0;
                // Without a notification (or as a safety net), look again in two seconds.
                WaitHandle.WaitAny([changed, cancel.Token.WaitHandle], TimeSpan.FromSeconds(watching ? 2 : 1));
            }
            catch (Exception error) when (error is IOException or System.Security.SecurityException or ObjectDisposedException)
            {
                Thread.Sleep(2000);
            }
            if (!cancel.IsCancellationRequested) Refresh();
        }
    }

    public void Dispose()
    {
        cancel.Cancel();
        thread?.Join(TimeSpan.FromSeconds(1));
        cancel.Dispose();
    }
}
