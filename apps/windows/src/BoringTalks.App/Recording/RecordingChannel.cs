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
/// </summary>
public sealed class RecordingChannel
{
    private const int BacklogLimit = 16000 * 60 * 20;

    private readonly long clockStart;
    private readonly RecordingWriter writer;
    private readonly Channel<Func<Task>> jobs = Channel.CreateUnbounded<Func<Task>>(new UnboundedChannelOptions { SingleReader = true });
    private readonly To16k to16k = new();
    // Worker-confined.
    private readonly ChannelTimeline timeline = new();
    private readonly List<float[]> backlog = [];
    private int backlogSamples;
    private bool droppedBacklog;
    private PhraseTranscriber? transcriber;

    public RecordingChannel(AudioChannel kind, long clockStart, RecordingWriter writer)
    {
        Kind = kind;
        this.clockStart = clockStart;
        this.writer = writer;
        _ = Task.Run(async () =>
        {
            await foreach (var job in jobs.Reader.ReadAllAsync()) await job();
        });
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

    /// <summary>Fills the silence up to now if the capture has stalled (or plays nothing).</summary>
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
