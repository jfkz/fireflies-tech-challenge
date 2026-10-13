using System.IO.Pipes;
using System.Text;
using BoringTalks.Core;

namespace BoringTalks.App.Platform;

/// <summary>
/// One BoringTalks (and one BoringTalks Dev) per user. A second launch (a <c>boringtalks://</c> link from the browser, a
/// click on the Start menu shortcut) hands its arguments to the running one over a named pipe
/// and exits.
/// </summary>
public sealed class SingleInstance : IDisposable
{
    private static readonly string Name = $"{AppFlavor.Current.Id}-{Environment.UserName}";
    private readonly Mutex mutex;
    private readonly CancellationTokenSource cancel = new();

    private SingleInstance(Mutex mutex) => this.mutex = mutex;

    /// <summary>This process is the one; null when another BoringTalks is already running.</summary>
    public static SingleInstance? Claim()
    {
        var mutex = new Mutex(true, $@"Local\{Name}", out var created);
        if (created) return new SingleInstance(mutex);
        mutex.Dispose();
        return null;
    }

    /// <summary>Sends this launch's arguments to the running instance. False if it didn't answer.</summary>
    public static bool Forward(string[] arguments)
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", Name, PipeDirection.Out);
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
        _ = Task.Run(async () =>
        {
            while (!cancel.IsCancellationRequested)
            {
                try
                {
                    await using var pipe = new NamedPipeServerStream(Name, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
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
        mutex.ReleaseMutex();
        mutex.Dispose();
        cancel.Dispose();
    }
}
