using System.IO.Pipes;
using System.Text;
using BoringTalks.Core;

namespace BoringTalks.App.Platform;

public enum ClaimResult
{
    /// <summary>This process is the one BoringTalks.</summary>
    Claimed,
    /// <summary>This build is running already: hand it the arguments.</summary>
    SameRunning,
    /// <summary>The other build (BoringTalks / BoringTalks Dev) is running.</summary>
    OtherRunning,
}

/// <summary>
/// One BoringTalks per user, of either build: two would record the same calls. A second launch of
/// the same build (a <c>boringtalks://</c> link from the browser, the Start menu shortcut) hands its
/// arguments to the running one over a named pipe and exits; a launch of the other build asks to
/// quit that one first. The app the updater restarts waits for the old one to finish exiting.
/// </summary>
public sealed class SingleInstance : IDisposable
{
    /// <summary>How long the restarted app waits for the one it replaces.</summary>
    public static readonly TimeSpan AfterUpdateWait = TimeSpan.FromSeconds(30);

    private static string PipeName(AppFlavor flavor) => $"{flavor.Id}-{Environment.UserName}";

    private readonly Mutex own;
    private readonly Mutex any;
    private readonly CancellationTokenSource cancel = new();

    private SingleInstance(Mutex own, Mutex any)
    {
        this.own = own;
        this.any = any;
    }

    /// <summary>Takes both locks (this build's, and the one any build holds), waiting up to <paramref name="wait"/> for each.</summary>
    public static (ClaimResult Result, SingleInstance? Instance) Claim(TimeSpan wait)
    {
        var own = new Mutex(false, $@"Local\{PipeName(AppFlavor.Current)}");
        if (!Acquire(own, wait))
        {
            own.Dispose();
            return (ClaimResult.SameRunning, null);
        }
        var any = new Mutex(false, $@"Local\BoringTalks-any-{Environment.UserName}");
        if (!Acquire(any, wait))
        {
            own.ReleaseMutex();
            own.Dispose();
            any.Dispose();
            return (ClaimResult.OtherRunning, null);
        }
        return (ClaimResult.Claimed, new SingleInstance(own, any));
    }

    private static bool Acquire(Mutex mutex, TimeSpan wait)
    {
        try
        {
            return mutex.WaitOne(wait);
        }
        catch (AbandonedMutexException)
        {
            // The last holder died without letting go (a crash, a kill): it's ours now.
            return true;
        }
    }

    /// <summary>Sends arguments to the running instance of <paramref name="flavor"/> (this build by default). False if it didn't answer.</summary>
    public static bool Forward(string[] arguments, AppFlavor? flavor = null)
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", PipeName(flavor ?? AppFlavor.Current), PipeDirection.Out);
            pipe.Connect(3000);
            var bytes = Encoding.UTF8.GetBytes(string.Join('\n', arguments));
            pipe.Write(bytes);
            pipe.Flush();
            return true;
        }
        catch (Exception error) when (error is TimeoutException or IOException)
        {
            return false;
        }
    }

    /// <summary>Calls <paramref name="received"/> (on a background thread) with each later launch's arguments.</summary>
    public void Listen(Action<string[]> received)
    {
        var name = PipeName(AppFlavor.Current);
        _ = Task.Run(async () =>
        {
            while (!cancel.IsCancellationRequested)
            {
                try
                {
                    await using var pipe = new NamedPipeServerStream(name, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                    await pipe.WaitForConnectionAsync(cancel.Token);
                    using var reader = new StreamReader(pipe, Encoding.UTF8);
                    var text = await reader.ReadToEndAsync(cancel.Token);
                    received(text.Split('\n', StringSplitOptions.RemoveEmptyEntries));
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch (IOException)
                {
                }
            }
        });
    }

    public void Dispose()
    {
        cancel.Cancel();
        foreach (var mutex in new[] { any, own })
        {
            try
            {
                mutex.ReleaseMutex();
            }
            catch (ApplicationException)
            {
                // Not held by this thread (already released).
            }
            mutex.Dispose();
        }
        cancel.Dispose();
    }
}
