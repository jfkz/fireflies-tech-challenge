using System.Diagnostics;
using System.Threading.Channels;
using BoringTalks.App.Audio;
using BoringTalks.Core.Audio;
using BoringTalks.Core.Speech;
using BoringTalks.Core.Transcript;

namespace BoringTalks.App.Recording;

/// <summary>
/// One side of the meeting on its way from the capture to the transcriber and the recording:
/// resampled to 16 kHz on the capture thread, then kept on the meeting clock (silence fills any
/// gap) on a worker of its own.
/// <para>
/// Until the speech model is ready the audio waits in a backlog and is transcribed as soon as it
/// is (up to 20 minutes; past that the meeting is left for the server to transcribe from the audio).
/// </para>
/// <para>
/// A side that plays nothing (or stalls) is caught up with silence twice a second by a timer of its
/// own, not the UI thread's: if that ever stops, the other side's audio would pile up in the mix.
/// </para>
/// </summary>
public sealed class RecordingChannel : IDisposable
{
    public static readonly TimeSpan CatchUpInterval = TimeSpan.FromMilliseconds(500);

    private const int BacklogLimit = 16000 * 60 * 20;

    private readonly long clockStart;
    private readonly RecordingWriter writer;
    private readonly Channel<Func<Task>> jobs = Channel.CreateUnbounded<Func<Task>>(new UnboundedChannelOptions { SingleReader = true });
    private readonly To16k to16k = new();
    private readonly Timer catchUp;
    // Worker-confined.
    private readonly ChannelTimeline timeline = new();
    private readonly List<float[]> backlog = [];
    private int backlogSamples;
    private bool droppedBacklog;
    private PhraseTranscriber? transcriber;

    /// <param name="keepBacklog">False when nothing will transcribe this channel (upload only): no backlog to keep.</param>
    public RecordingChannel(AudioChannel kind, long clockStart, RecordingWriter writer, bool keepBacklog = true)
    {
        Kind = kind;
        droppedBacklog = !keepBacklog;
        this.clockStart = clockStart;
        this.writer = writer;
        _ = Task.Run(async () =>
        {
            await foreach (var job in jobs.Reader.ReadAllAsync()) await job();
        });
        catchUp = new Timer(_ => CatchUp(), null, CatchUpInterval, CatchUpInterval);
    }

    public AudioChannel Kind { get; }
    public LevelMeter Meter { get; } = new();

    private double Elapsed => Stopwatch.GetElapsedTime(clockStart).TotalSeconds;

    /// <summary>Called on the capture thread.</summary>
    public void Ingest(CapturedAudio audio)
    {
        var elapsed = Elapsed;
        Meter.Push(audio.Samples, audio.Samples.Length / (float)audio.SampleRate);
        var samples = to16k.Convert(audio);
        if (samples.Length > 0) Post(() => Process(samples, elapsed));
    }

    /// <summary>Fills the silence up to now if the capture has stalled (or plays nothing). On the timer's thread.</summary>
    public void CatchUp()
    {
        var elapsed = Elapsed;
        Post(() =>
        {
            var silence = timeline.CatchUp(elapsed);
            if (silence > 0) Deliver(new float[silence]);
        });
    }

    /// <summary>Hands the backlog and everything after it to <paramref name="next"/>, in order.</summary>
    public Task AttachAsync(PhraseTranscriber next) => Run(() =>
    {
        if (!droppedBacklog)
        {
            foreach (var chunk in backlog) next.Feed(chunk);
        }
        backlog.Clear();
        backlogSamples = 0;
        transcriber = next;
    });

    public sealed record Ending(bool Transcribed, PhraseTranscriber? Transcriber);

    /// <summary>After the capture stopped: brings the channel up to <paramref name="elapsed"/> and waits for everything queued.</summary>
    public async Task<Ending> EndAsync(double elapsed)
    {
        // The meeting ends at elapsed: no silence after it.
        catchUp.Change(Timeout.Infinite, Timeout.Infinite);
        Ending ending = new(false, null);
        await Run(() =>
        {
            var behind = (int)(elapsed * 16000) - (int)timeline.Written;
            if (behind > 0)
            {
                timeline.CatchUp(elapsed, lag: 0);
                Deliver(new float[behind]);
            }
            ending = new Ending(transcriber is not null && !droppedBacklog, transcriber);
        });
        return ending;
    }

    private void Process(float[] samples, double elapsed)
    {
        var silence = timeline.SilenceBefore(samples.Length, elapsed);
        if (silence > 0) Deliver(new float[silence]);
        Deliver(samples);
    }

    private void Deliver(float[] chunk)
    {
        writer.Append(chunk, Kind);
        if (transcriber is not null)
        {
            transcriber.Feed(chunk);
        }
        else if (!droppedBacklog)
        {
            backlog.Add(chunk);
            backlogSamples += chunk.Length;
            if (backlogSamples > BacklogLimit)
            {
                backlog.Clear();
                backlogSamples = 0;
                droppedBacklog = true;
            }
        }
    }

    /// <summary>The meeting is over (or this side never started): no more catching up, and the worker ends.</summary>
    public void Dispose()
    {
        catchUp.Dispose();
        jobs.Writer.TryComplete();
    }

    private void Post(Action job) => jobs.Writer.TryWrite(() =>
    {
        job();
        return Task.CompletedTask;
    });

    private Task Run(Action job)
    {
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        jobs.Writer.TryWrite(() =>
        {
            job();
            done.SetResult();
            return Task.CompletedTask;
        });
        return done.Task;
    }
}
