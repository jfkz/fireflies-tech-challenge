using System.Diagnostics;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using NAudio.CoreAudioApi;
using BoringTalks.App.Audio;
using BoringTalks.Core;
using BoringTalks.Core.Audio;
using BoringTalks.Core.Calls;
using BoringTalks.Core.Speech;
using BoringTalks.Core.Transcript;
using BoringTalks.Core.Uploads;
using BoringTalks.Speech;

namespace BoringTalks.App.Recording;

public enum RecorderPhase
{
    Idle,
    Starting,
    Recording,
    Finishing,
}

public abstract record AutoStopReason
{
    /// <summary>Nobody spoke for this many seconds.</summary>
    public sealed record Silence(double Limit) : AutoStopReason;
    /// <summary>The app holding the call released the microphone.</summary>
    public sealed record CallEnded(string App) : AutoStopReason;
}

/// <summary>The recording stops by itself at <c>At</c> unless someone keeps it going.</summary>
public sealed record PendingStop(AutoStopReason Reason, DateTimeOffset At);

/// <summary>
/// Records one meeting: the microphone is "You", what the PC plays is everyone else. Both channels
/// run on one clock (seconds since Start), go to their own transcriber, and are mixed into one AAC
/// file. Stop hands back a <see cref="PendingMeeting"/> for the upload queue. Lives on the UI thread.
/// </summary>
public sealed partial class MeetingRecorder : ObservableObject
{
    private readonly SpeechModels models;
    private readonly AppFolders folders;
    /// <summary>How long a side may take to start before the meeting goes on without it.</summary>
    public static readonly TimeSpan StartTimeout = TimeSpan.FromSeconds(10);

    private readonly AudioDevices devices;
    private readonly Dispatcher ui;
    private readonly Action<string> log;
    private readonly Dictionary<AudioChannel, RecordingChannel> channels = [];
    private readonly Dictionary<AudioChannel, IAudioCapture> captures = [];
    private readonly Dictionary<AudioChannel, LevelMeter> idleMeters = new() { [AudioChannel.Microphone] = new(), [AudioChannel.System] = new() };
    private readonly Dictionary<AudioChannel, DispatcherTimer> restarts = [];
    private readonly Dictionary<AudioChannel, double> lastSpeech = [];
    private readonly HashSet<AudioChannel> attached = [];
    private readonly List<PhraseRecord> records = [];
    private readonly Dictionary<AudioChannel, PhraseTranscriber> transcribers = [];
    private RecordingWriter? writer;
    private VoiceRegistry registry = new();
    private (Guid Id, string? Title, string? Language, bool UploadAudio)? meeting;
    private long clockStart;
    private DispatcherTimer? ticker;
    private Task attaching = Task.CompletedTask;
    private SilenceWatch silence = new(0);
    private CallEndWatch callEnd = new();
    private string? endedCallApp;
    private bool autoStopReported;

    public MeetingRecorder(SpeechModels models, AppFolders folders, AudioDevices devices, Dispatcher ui, Action<string> log)
    {
        this.models = models;
        this.folders = folders;
        this.devices = devices;
        this.ui = ui;
        this.log = log;
        devices.Changed += flow => ui.BeginInvoke(() =>
        {
            if (Phase != RecorderPhase.Recording) return;
            if (flow is DataFlow.Capture or DataFlow.All && channels.ContainsKey(AudioChannel.Microphone)) ScheduleRestart(AudioChannel.Microphone);
            // Process loopback follows the output device by itself; the fallback has to be reopened.
            if (flow is DataFlow.Render or DataFlow.All && captures.GetValueOrDefault(AudioChannel.System) is SystemAudioCapture { AllDevices: false }) ScheduleRestart(AudioChannel.System);
        });
    }

    [ObservableProperty] public partial RecorderPhase Phase { get; private set; } = RecorderPhase.Idle;
    [ObservableProperty] public partial DateTimeOffset? StartedAt { get; private set; }
    /// <summary>Problems with one side ("Microphone access is off…").</summary>
    [ObservableProperty] public partial IReadOnlyList<string> Warnings { get; private set; } = [];
    /// <summary>Recording while the speech model is still loading; audio waits for it.</summary>
    [ObservableProperty] public partial bool WaitingForModel { get; private set; }
    /// <summary>The microphone recording "You" (shown in the menu).</summary>
    [ObservableProperty] public partial string? MicrophoneName { get; private set; }
    [ObservableProperty] public partial PendingStop? PendingStop { get; private set; }

    private readonly Dictionary<AudioChannel, string> warnings = [];

    /// <summary>See <see cref="Settings.AvoidBluetoothMic"/>; read when a meeting starts.</summary>
    public bool AvoidBluetoothMic { get; set; } = true;
    /// <summary>Quiet this long (seconds) stops the meeting; 0 never does. Read when a meeting starts.</summary>
    public double SilenceLimit { get; set; } = 300;

    /// <summary>The silence countdown began (with the seconds left), or was called off (null).</summary>
    public event Action<double?>? SilenceWarning;
    /// <summary>Time to stop. The owner stops the meeting.</summary>
    public event Action<AutoStopReason>? AutoStop;

    public LiveTranscript Live { get; } = new();

    public bool IsRecording => Phase == RecorderPhase.Recording;

    public LevelMeter Meter(AudioChannel channel) => channels.TryGetValue(channel, out var c) ? c.Meter : idleMeters[channel];

    /// <summary>The file being recorded now, which the janitor must leave alone.</summary>
    public string? CurrentFileName => meeting is { } m ? $"{m.Id}.m4a" : null;

    private double ClockNow => Stopwatch.GetElapsedTime(clockStart).TotalSeconds;

    public async Task StartAsync(string? title, string? language, bool uploadAudio)
    {
        if (Phase != RecorderPhase.Idle) return;
        Phase = RecorderPhase.Starting;
        warnings.Clear();
        PublishWarnings();
        records.Clear();
        Live.Reset();
        registry = new VoiceRegistry();
        silence = new SilenceWatch(SilenceLimit);
        callEnd = new CallEndWatch();
        endedCallApp = null;
        lastSpeech.Clear();
        autoStopReported = false;
        PendingStop = null;
        var id = Guid.NewGuid();
        var trimmed = title?.Trim();
        meeting = (id, string.IsNullOrEmpty(trimmed) ? null : trimmed, language, uploadAudio);

        try
        {
            folders.Create();
            writer = new RecordingWriter(Path.Combine(folders.Recordings, $"{id}.m4a"), log);
            clockStart = Stopwatch.GetTimestamp();
            StartedAt = DateTimeOffset.Now;
            foreach (var kind in Enum.GetValues<AudioChannel>()) channels[kind] = new RecordingChannel(kind, clockStart, writer);

            // Keep both sides on the clock from the first moment: a side that is slow to start
            // (or never does), or plays nothing, is filled with silence instead of stalling the mix.
            ticker = new DispatcherTimer(TimeSpan.FromMilliseconds(500), DispatcherPriority.Background, (_, _) =>
            {
                foreach (var channel in channels.Values) channel.CatchUp();
                CheckAutoStop();
            }, ui);
            ticker.Start();

            // Both sides at once: the first words of a call must not wait for the other side's device.
            var started = await Task.WhenAll(StartCaptureAsync(AudioChannel.Microphone), StartCaptureAsync(AudioChannel.System));
            if (!started.Any(s => s)) throw new CaptureException($"Couldn't record: {string.Join(" ", warnings.Values)}");
        }
        catch
        {
            await AbandonAsync();
            throw;
        }

        Phase = RecorderPhase.Recording;
        log($"recording {id}");
        // Transcribe as soon as the model is there; until then the audio waits.
        WaitingForModel = !models.IsReady;
        _ = WaitForModelAsync(id);
    }

    private async Task WaitForModelAsync(Guid id)
    {
        if (!await models.PrepareAsync()) return;
        await ui.InvokeAsync(async () =>
        {
            if (meeting?.Id == id && Phase == RecorderPhase.Recording) await AttachTranscribersAsync([.. channels.Keys]);
        }).Task.Unwrap();
    }

    /// <summary>Stops and returns the meeting to upload (null if nothing was recorded).</summary>
    public async Task<PendingMeeting?> StopAsync()
    {
        if (Phase != RecorderPhase.Recording || meeting is not { } current || writer is null || StartedAt is not { } startedAt) return null;
        Phase = RecorderPhase.Finishing;
        ticker?.Stop();
        foreach (var timer in restarts.Values) timer.Stop();
        foreach (var capture in captures.Values) capture.Dispose();
        captures.Clear();
        var elapsed = ClockNow;
        // A model that has just arrived may be attaching right now.
        await attaching;

        var endings = new Dictionary<AudioChannel, RecordingChannel.Ending>();
        foreach (var (kind, channel) in channels) endings[kind] = await channel.EndAsync(elapsed);
        // The model may have finished loading just now.
        var missing = endings.Keys.Where(k => !attached.Contains(k)).ToList();
        if (models.IsReady && missing.Count > 0)
        {
            await AttachTranscribersAsync(missing);
            foreach (var kind in missing) endings[kind] = await channels[kind].EndAsync(elapsed);
        }
        foreach (var ending in endings.Values)
        {
            if (ending.Transcriber is { } transcriber) await transcriber.FinishAsync();
        }
        foreach (var transcriber in transcribers.Values) await transcriber.DisposeAsync();
        transcribers.Clear();
        var seconds = await writer.FinishAsync();

        // Sides that couldn't start count as heard (there is nothing to transcribe).
        var transcribed = endings.All(pair => pair.Value.Transcribed || warnings.ContainsKey(pair.Key));
        var segments = transcribed ? SegmentAssembler.Assemble(records) : [];
        if (!transcribed) log("no local transcript; the server will transcribe the audio");
        var language = current.Language ?? LanguageGuess.Detect(string.Join(" ", segments.Select(s => s.Text)));
        var hasFile = writer.HasFile && seconds > 0.5 && File.Exists(writer.Path);
        if (!hasFile) TryDelete(writer.Path);

        var pending = new PendingMeeting
        {
            Id = current.Id,
            Title = current.Title,
            StartedAt = startedAt,
            DurationSec = (int)Math.Round(elapsed),
            Language = language,
            Segments = segments,
            AudioFileName = hasFile ? Path.GetFileName(writer.Path) : null,
            UploadAudio = current.UploadAudio,
        };
        Reset();
        log($"stopped: {segments.Count} segments, {(int)elapsed} s");
        return pending.HasContent(hasFile) ? pending : null;
    }

    // ---- Capture

    private async Task<bool> StartCaptureAsync(AudioChannel kind)
    {
        if (!channels.TryGetValue(kind, out var channel)) return false;
        try
        {
            IAudioCapture capture = kind == AudioChannel.Microphone ? new MicCapture(AvoidBluetoothMic, log) : new SystemAudioCapture(log);
            capture.Audio += channel.Ingest;
            capture.Stopped += error => ui.BeginInvoke(() =>
            {
                log($"{kind} capture stopped: {error?.Message ?? "no reason"}");
                ScheduleRestart(kind);
            });
            var clock = Stopwatch.StartNew();
            var starting = Task.Run(capture.Start);
            if (await Task.WhenAny(starting, Task.Delay(StartTimeout)) != starting)
            {
                // A driver that never answers mustn't hold the meeting up: record the other side,
                // and let the stuck capture go whenever it returns.
                log($"{kind} didn't start in {StartTimeout.TotalSeconds:0} s; recording without it");
                _ = starting.ContinueWith(_ => capture.Dispose(), TaskScheduler.Default);
                throw new CaptureException(kind == AudioChannel.Microphone
                    ? "The microphone didn't answer. Check it's connected and not held by another app, then start again."
                    : "The PC's sound didn't answer.");
            }
            await starting;
            log($"{kind} started in {clock.ElapsedMilliseconds} ms: {capture.DeviceName}");
            captures[kind] = capture;
            if (kind == AudioChannel.Microphone) MicrophoneName = capture.DeviceName;
            warnings.Remove(kind);
            PublishWarnings();
            return true;
        }
        catch (Exception error)
        {
            // One side failing never stops the other from recording.
            if (error is not CaptureException) Platform.Log.Error("recorder", $"{kind} capture failed", error);
            Fail(kind, error.Message);
            return false;
        }
    }

    private void Fail(AudioChannel kind, string message)
    {
        warnings[kind] = kind == AudioChannel.System ? $"Others: {message}" : message;
        PublishWarnings();
        // A side that never started has nothing to transcribe. (One that fails on a device change
        // keeps its channel, so what it heard is still transcribed.)
        if (Phase == RecorderPhase.Starting)
        {
            writer?.Remove(kind);
            channels.Remove(kind);
        }
        log($"{kind}: {message}");
    }

    private void PublishWarnings() => Warnings = [.. warnings.OrderBy(w => w.Key).Select(w => w.Value)];

    /// <summary>Device changes arrive in bursts; restart that capture once they settle. The timeline fills the gap with silence.</summary>
    private void ScheduleRestart(AudioChannel kind)
    {
        if (Phase != RecorderPhase.Recording) return;
        if (restarts.TryGetValue(kind, out var pending)) pending.Stop();
        var timer = new DispatcherTimer(TimeSpan.FromMilliseconds(400), DispatcherPriority.Normal, async (sender, _) =>
        {
            ((DispatcherTimer)sender!).Stop();
            if (Phase != RecorderPhase.Recording) return;
            log($"audio device changed; restarting {kind}");
            if (captures.Remove(kind, out var old)) old.Dispose();
            await StartCaptureAsync(kind);
        }, ui);
        restarts[kind] = timer;
        timer.Start();
    }

    // ---- Transcription

    /// <summary>
    /// Gives each channel in <paramref name="kinds"/> that has none yet its transcriber (fed its
    /// backlog first). Marked before awaiting, so Stop pressed while the model arrives can never
    /// attach a second one.
    /// </summary>
    private async Task AttachTranscribersAsync(IReadOnlyList<AudioChannel> kinds)
    {
        WaitingForModel = false;
        var pending = kinds.Where(k => !attached.Contains(k)).ToList();
        // Until now the meters said when someone was heard; the transcriber starts on the backlog,
        // so carry that over rather than count the wait as quiet.
        foreach (var kind in pending) lastSpeech[kind] = Math.Max(lastSpeech.GetValueOrDefault(kind), MeterActivity([kind]));
        attached.UnionWith(pending);
        var language = meeting?.Language;
        var previous = attaching;
        attaching = AttachAsync();
        await attaching;

        async Task AttachAsync()
        {
            await previous;
            if (models.Engine is not { } engine) return;
            foreach (var kind in pending)
            {
                if (!channels.TryGetValue(kind, out var channel)) continue;
                var voices = kind == AudioChannel.System ? models.Voices : null;
                var transcriber = new PhraseTranscriber(new ParakeetRecognizer(engine), language, e => ui.BeginInvoke(() => Receive(e, kind)),
                    voices is null ? null : registry, voices);
                transcribers[kind] = transcriber;
                await channel.AttachAsync(transcriber);
            }
        }
    }

    private void Receive(PhraseEvent e, AudioChannel channel)
    {
        var startMs = (int)(e.Start * 1000 / 16000);
        var endMs = (int)(e.End * 1000 / 16000);
        Live.Receive(e.Text, e.IsFinal, channel, e.Speaker?.Voice, startMs);
        if (e.Text.Length > 0) lastSpeech[channel] = Math.Max(lastSpeech.GetValueOrDefault(channel), e.End / 16000.0);
        if (e.IsFinal && e.Text.Length > 0) records.Add(new PhraseRecord(channel, e.Speaker?.Voice, startMs, endMs, e.Text));
    }

    // ---- Stopping by itself

    /// <summary>Someone is still there: the quiet starts counting again from now, and a call-end countdown is called off.</summary>
    public void KeepRecording()
    {
        if (Phase != RecorderPhase.Recording) return;
        silence.KeepRecording(ClockNow);
        callEnd.Cancel();
        endedCallApp = null;
        SetPendingStop(null);
    }

    /// <summary>The app holding the call released the microphone: stop once the other side has been quiet for a little while.</summary>
    public void CallEnded(string app)
    {
        if (Phase != RecorderPhase.Recording) return;
        log($"{app} released the microphone");
        endedCallApp = app;
        callEnd.CallEnded(ClockNow);
    }

    /// <summary>…and took it back (a reconnect or a device switch).</summary>
    public void CallResumed()
    {
        if (endedCallApp is null) return;
        callEnd.Cancel();
        endedCallApp = null;
        if (PendingStop?.Reason is AutoStopReason.CallEnded) SetPendingStop(null);
    }

    /// <summary>Called every half second while recording.</summary>
    private void CheckAutoStop()
    {
        if (Phase != RecorderPhase.Recording || autoStopReported) return;
        var now = ClockNow;
        if (endedCallApp is { } app)
        {
            switch (callEnd.Verdict(OthersActivity(), now))
            {
                case CallEndVerdict.Stop:
                    Report(new AutoStopReason.CallEnded(app));
                    return;
                case CallEndVerdict.Stopping(var left):
                    SetPendingStop(new PendingStop(new AutoStopReason.CallEnded(app), DateTimeOffset.Now.AddSeconds(left)));
                    return;
            }
        }
        if (!silence.IsOn)
        {
            SetPendingStop(null);
            return;
        }
        var lastActivity = Activity([.. channels.Keys]);
        switch (silence.Verdict(lastActivity, now))
        {
            case SilenceVerdict.Listening:
                SetPendingStop(null);
                break;
            case SilenceVerdict.Warning(var left):
                if (PendingStop?.Reason is AutoStopReason.Silence) return;
                log($"quiet for {(int)silence.Quiet(lastActivity, now)} s; stopping in {(int)left} s");
                SetPendingStop(new PendingStop(new AutoStopReason.Silence(silence.Limit), DateTimeOffset.Now.AddSeconds(left)));
                break;
            case SilenceVerdict.Stop:
                Report(new AutoStopReason.Silence(silence.Limit));
                break;
        }
    }

    private void Report(AutoStopReason reason)
    {
        autoStopReported = true;
        SetPendingStop(null);
        log($"stopping by itself: {reason}");
        AutoStop?.Invoke(reason);
    }

    /// <summary>Updates the countdown the menu shows; tells the owner when a silence warning starts or ends.</summary>
    private void SetPendingStop(PendingStop? next)
    {
        var old = PendingStop;
        // The call-end countdown moves each time the others speak; skip sub-second jitter.
        if (old is not null && next is not null && old.Reason == next.Reason && Math.Abs((old.At - next.At).TotalSeconds) < 1) return;
        if (old == next) return;
        PendingStop = next;
        var wasSilence = old?.Reason is AutoStopReason.Silence;
        var isSilence = next?.Reason is AutoStopReason.Silence;
        if (isSilence && !wasSilence) SilenceWarning?.Invoke((next!.At - DateTimeOffset.Now).TotalSeconds);
        else if (wasSilence && !isSilence) SilenceWarning?.Invoke(null);
    }

    /// <summary>When someone was last heard on any of <paramref name="kinds"/> (meeting clock): from the transcript, or the level meter while that side has no transcriber yet.</summary>
    private double Activity(IReadOnlyList<AudioChannel> kinds) =>
        kinds.Count == 0 ? 0 : kinds.Max(k => attached.Contains(k) ? lastSpeech.GetValueOrDefault(k) : MeterActivity([k]));

    /// <summary>The other side, or everyone when system audio isn't recorded.</summary>
    private double OthersActivity() => Activity(channels.ContainsKey(AudioChannel.System) ? [AudioChannel.System] : [.. channels.Keys]);

    /// <summary>When the meters of <paramref name="kinds"/> last heard a clear sound (meeting clock).</summary>
    private double MeterActivity(IReadOnlyList<AudioChannel> kinds)
    {
        var now = ClockNow;
        var heard = kinds.Where(channels.ContainsKey).Select(k => now - channels[k].Meter.Read().SinceSound).ToList();
        return heard.Count == 0 ? 0 : heard.Max();
    }

    // ---- Teardown

    private async Task AbandonAsync()
    {
        foreach (var capture in captures.Values) capture.Dispose();
        if (writer is not null)
        {
            await writer.FinishAsync();
            TryDelete(writer.Path);
        }
        Reset();
    }

    private void Reset()
    {
        ticker?.Stop();
        ticker = null;
        foreach (var timer in restarts.Values) timer.Stop();
        restarts.Clear();
        foreach (var capture in captures.Values) capture.Dispose();
        captures.Clear();
        channels.Clear();
        writer?.Dispose();
        writer = null;
        meeting = null;
        StartedAt = null;
        WaitingForModel = false;
        PendingStop = null;
        endedCallApp = null;
        MicrophoneName = null;
        attached.Clear();
        attaching = Task.CompletedTask;
        Phase = RecorderPhase.Idle;
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (IOException)
        {
        }
    }
}
