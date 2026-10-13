using BoringTalks.Core.Api;

namespace BoringTalks.Core.Uploads;

public sealed record UploadSnapshot
{
    public IReadOnlyList<PendingMeeting> Items { get; init; } = [];
    public bool IsOnline { get; init; } = true;
    /// <summary>The token was refused; nothing uploads until the user signs in again.</summary>
    public bool NeedsSignIn { get; init; }
    /// <summary>The meeting being uploaded right now.</summary>
    public Guid? ActiveId { get; init; }
    /// <summary>Grows by one per finished upload, so observers know to refresh lists.</summary>
    public int UploadedCount { get; init; }
    /// <summary>Server id of the last finished upload.</summary>
    public string? LastUploadedRemoteId { get; init; }

    public int Waiting => Items.Count(i => !i.IsFailed);
    public int Failed => Items.Count(i => i.IsFailed);
}

/// <summary>
/// Uploads finished meetings one step at a time, in the background:
/// create → audio (optional) → transcript → complete.
/// <list type="bullet">
/// <item>Every change is persisted before the next request, so a relaunch resumes at
/// the step that was interrupted. Each step is idempotent on the server.</item>
/// <item>Network and server errors retry with exponential backoff; going back online
/// retries at once. 401 pauses the whole queue until the user signs in again.</item>
/// <item>Anything else the server refuses marks that meeting failed, for the user to
/// retry or discard.</item>
/// </list>
/// </summary>
public sealed class UploadQueue : IAsyncDisposable
{
    private readonly IMeetingsApi api;
    private readonly IUploadStore store;
    private readonly string recordings;
    private readonly TimeProvider time;
    private readonly Backoff backoff;
    private readonly Action<string>? log;
    private readonly Lock gate = new();
    private readonly SemaphoreSlim processing = new(1, 1);
    private UploadSnapshot snapshot = new();
    /// <summary>Days to keep audio on this PC after it uploaded; 0 deletes it at once.</summary>
    private int keepAudioDays;
    private CancellationTokenSource? loopCancel;
    private Task? loop;
    private TaskCompletionSource wake = NewWake();

    public UploadQueue(IMeetingsApi api, IUploadStore store, string recordings, int keepAudioDays = 7,
        Backoff? backoff = null, TimeProvider? time = null, Action<string>? log = null)
    {
        this.api = api;
        this.store = store;
        this.recordings = recordings;
        this.keepAudioDays = keepAudioDays;
        this.backoff = backoff ?? new Backoff();
        this.time = time ?? TimeProvider.System;
        this.log = log;
    }

    /// <summary>Raised (on any thread) whenever the queue changes.</summary>
    public event Action<UploadSnapshot>? Changed;

    public UploadSnapshot Current
    {
        get { lock (gate) return snapshot; }
    }

    /// <summary>Reads what was left from the last run.</summary>
    public void Load()
    {
        try
        {
            var items = store.Load();
            Mutate(s => s with { Items = items }, persist: false);
        }
        catch (Exception error)
        {
            log?.Invoke($"couldn't read the upload queue: {error.Message}");
            Publish();
        }
    }

    public void Enqueue(PendingMeeting meeting)
    {
        Mutate(s => s with { Items = [.. s.Items.Where(i => i.Id != meeting.Id), meeting] });
        Kick();
    }

    public void SetOnline(bool online)
    {
        if (Current.IsOnline == online) return;
        if (online)
        {
            // Back online: don't sit out the backoff.
            Mutate(s => s with { IsOnline = true, Items = [.. s.Items.Select(i => i with { NextAttemptAt = null })] });
            Kick();
        }
        else
        {
            Mutate(s => s with { IsOnline = false }, persist: false);
        }
    }

    /// <summary>After signing in again.</summary>
    public void Resume()
    {
        Mutate(s => s with { NeedsSignIn = false, Items = [.. s.Items.Select(i => i with { NextAttemptAt = null })] });
        Kick();
    }

    public void SetKeepAudioDays(int days)
    {
        lock (gate) keepAudioDays = Math.Max(0, days);
    }

    /// <summary>Tries a failed (or waiting) meeting again now.</summary>
    public void Retry(Guid id)
    {
        Update(id, i => i with { IsFailed = false, Attempts = 0, NextAttemptAt = null });
        Kick();
    }

    /// <summary>Drops a meeting from the queue (its audio file stays until it ages out).</summary>
    public void Discard(Guid id) => Mutate(s => s with { Items = [.. s.Items.Where(i => i.Id != id)] });

    /// <summary>Audio files the queue still needs; the janitor must not delete them.</summary>
    public IReadOnlySet<string> ProtectedFiles => Current.Items.Select(i => i.AudioFileName).OfType<string>().ToHashSet(StringComparer.OrdinalIgnoreCase);

    /// <summary>Keeps processing in the background until <see cref="StopAsync"/>.</summary>
    public void Start()
    {
        lock (gate)
        {
            if (loop is not null) return;
            loopCancel = new CancellationTokenSource();
            var token = loopCancel.Token;
            loop = Task.Run(() => RunLoopAsync(token), CancellationToken.None);
        }
    }

    public async Task StopAsync()
    {
        Task? running;
        lock (gate)
        {
            loopCancel?.Cancel();
            running = loop;
            loop = null;
        }
        Kick();
        if (running is not null)
        {
            try
            {
                await running;
            }
            catch (OperationCanceledException)
            {
            }
        }
        lock (gate)
        {
            loopCancel?.Dispose();
            loopCancel = null;
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        processing.Dispose();
    }

    /// <summary>Wakes the background loop (new item, back online, signed in).</summary>
    public void Kick()
    {
        lock (gate) wake.TrySetResult();
    }

    /// <summary>
    /// Uploads every meeting that is due now, step by step. Returns when each of
    /// them is done, failed, or waiting for a retry.
    /// </summary>
    public async Task ProcessDueAsync(CancellationToken cancellation = default)
    {
        if (!await processing.WaitAsync(0, cancellation)) return;
        try
        {
            while (!cancellation.IsCancellationRequested)
            {
                PendingMeeting? item;
                lock (gate)
                {
                    item = snapshot.IsOnline && !snapshot.NeedsSignIn ? snapshot.Items.FirstOrDefault(IsDue) : null;
                }
                if (item is null) break;
                Mutate(s => s with { ActiveId = item.Id }, persist: false);
                await UploadAsync(item.Id, cancellation);
            }
        }
        finally
        {
            Mutate(s => s with { ActiveId = null }, persist: false);
            processing.Release();
        }
    }

    /// <summary>When the next waiting meeting is due, if any.</summary>
    public DateTimeOffset? NextDueDate()
    {
        lock (gate)
        {
            if (!snapshot.IsOnline || snapshot.NeedsSignIn) return null;
            var waiting = snapshot.Items.Where(i => !i.IsFailed).ToList();
            return waiting.Count == 0 ? null : waiting.Min(i => i.NextAttemptAt ?? DateTimeOffset.MinValue);
        }
    }

    // ---- Steps

    private bool IsDue(PendingMeeting item) =>
        !item.IsFailed && item.Step != UploadStep.Done && (item.NextAttemptAt is not { } at || at <= time.GetUtcNow());

    private string? AudioPath(PendingMeeting item) => item.AudioFileName is { } name ? Path.Combine(recordings, name) : null;

    private bool AudioExists(PendingMeeting item) => AudioPath(item) is { } path && File.Exists(path);

    private async Task UploadAsync(Guid id, CancellationToken cancellation)
    {
        while (!cancellation.IsCancellationRequested && Find(id) is { } item)
        {
            if (!item.HasContent(AudioExists(item)))
            {
                Update(id, i => i with { IsFailed = true, LastError = "Nothing to upload: no transcript and no audio file." });
                return;
            }
            if (item.Step == UploadStep.Done)
            {
                Finish(item);
                return;
            }
            if (item.Step != UploadStep.Create && item.RemoteId is null)
            {
                // Every later step needs the server id.
                Update(id, i => i with { Step = UploadStep.Create });
                continue;
            }
            try
            {
                var next = await PerformAsync(item, cancellation);
                Update(id, _ => next with
                {
                    Step = next.StepAfter(item.Step, AudioExists(next)),
                    Attempts = 0,
                    NextAttemptAt = null,
                    LastError = null,
                });
            }
            catch (ApiException error)
            {
                if (!Handle(error, item)) return;
            }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
            {
                return;
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or HttpRequestException)
            {
                RetryLater(item, error.Message);
                return;
            }
        }
    }

    /// <summary>Runs one step; returns the meeting with what the step learned (its server id).</summary>
    private async Task<PendingMeeting> PerformAsync(PendingMeeting item, CancellationToken cancellation)
    {
        switch (item.Step)
        {
            case UploadStep.Create when item.RemoteId is null:
                var title = item.Title is { Length: > ApiLimits.MaxTitleLength } longTitle ? longTitle[..ApiLimits.MaxTitleLength] : item.Title;
                var created = await api.CreateMeetingAsync(new CreateMeetingRequest(title, item.StartedAt, item.Language), item.Id.ToString(), cancellation);
                log?.Invoke($"created meeting {created.Id}");
                return item with { RemoteId = created.Id };
            case UploadStep.Audio when AudioPath(item) is { } file && item.RemoteId is { } remoteId:
                var size = File.Exists(file) ? new FileInfo(file).Length : 0;
                if (size <= 0 || size > ApiLimits.MaxAudioBytes)
                {
                    log?.Invoke($"skipping audio of {size} bytes");
                    return item;
                }
                var target = await api.RequestUploadUrlAsync(remoteId, new UploadUrlRequest((int)size, Channels: item.AudioChannels), cancellation);
                await api.UploadAudioAsync(file, target, cancellation);
                log?.Invoke($"uploaded {size} bytes of audio for {remoteId}");
                return item;
            case UploadStep.Transcript when item.RemoteId is { } remoteId:
                await api.PutTranscriptAsync(remoteId, new TranscriptUpload(item.Language, item.DurationSec, [.. item.Segments.Take(ApiLimits.MaxSegments)]), cancellation);
                return item;
            case UploadStep.Complete when item.RemoteId is { } remoteId:
                try
                {
                    await api.CompleteMeetingAsync(remoteId, new CompleteMeetingRequest(item.DurationSec), cancellation);
                }
                catch (ApiException error) when (error.Kind == ApiErrorKind.Conflict)
                {
                    // Completed by an earlier attempt whose answer got lost.
                }
                return item;
            default:
                return item;
        }
    }

    /// <summary>Returns true to go on with the next step of this meeting.</summary>
    private bool Handle(ApiException error, PendingMeeting item)
    {
        switch (error.Kind)
        {
            case ApiErrorKind.Unauthorized:
                Mutate(s => s with { NeedsSignIn = true });
                Update(item.Id, i => i with { LastError = error.Message });
                return false;
            case ApiErrorKind.NotFound when item.RemoteId is not null:
                // Deleted from the dashboard while waiting: nothing left to upload to.
                log?.Invoke($"meeting {item.RemoteId} is gone; dropping the upload");
                Discard(item.Id);
                return false;
            case ApiErrorKind.Conflict when item.Step != UploadStep.Create:
                // This step was already done.
                Update(item.Id, i => i with { Step = i.StepAfter(item.Step, AudioExists(i)) });
                return true;
            case ApiErrorKind.Server or ApiErrorKind.Offline:
                RetryLater(item, error.Message);
                return false;
            default:
                Update(item.Id, i => i with { IsFailed = true, LastError = error.Message });
                return false;
        }
    }

    private void RetryLater(PendingMeeting item, string error)
    {
        Update(item.Id, i => i with
        {
            Attempts = i.Attempts + 1,
            NextAttemptAt = time.GetUtcNow() + backoff.Delay(i.Attempts + 1),
            LastError = error,
        });
        log?.Invoke($"upload of {item.Id} will retry: {error}");
    }

    private void Finish(PendingMeeting item)
    {
        int keep;
        lock (gate) keep = keepAudioDays;
        if (keep == 0 && AudioPath(item) is { } file)
        {
            try
            {
                File.Delete(file);
            }
            catch (IOException)
            {
            }
        }
        Mutate(s => s with
        {
            Items = [.. s.Items.Where(i => i.Id != item.Id)],
            UploadedCount = s.UploadedCount + 1,
            LastUploadedRemoteId = item.RemoteId,
        });
        log?.Invoke($"meeting {item.RemoteId ?? "?"} uploaded");
    }

    private PendingMeeting? Find(Guid id)
    {
        lock (gate) return snapshot.Items.FirstOrDefault(i => i.Id == id);
    }

    private void Update(Guid id, Func<PendingMeeting, PendingMeeting> change) =>
        Mutate(s => s with { Items = [.. s.Items.Select(i => i.Id == id ? change(i) : i)] });

    private void Mutate(Func<UploadSnapshot, UploadSnapshot> change, bool persist = true)
    {
        UploadSnapshot next;
        lock (gate)
        {
            snapshot = change(snapshot);
            next = snapshot;
            if (persist)
            {
                try
                {
                    store.Save(next.Items);
                }
                catch (Exception error)
                {
                    log?.Invoke($"couldn't save the upload queue: {error.Message}");
                }
            }
        }
        Changed?.Invoke(next);
    }

    private void Publish() => Changed?.Invoke(Current);

    // ---- Background loop

    private async Task RunLoopAsync(CancellationToken cancellation)
    {
        while (!cancellation.IsCancellationRequested)
        {
            await ProcessDueAsync(cancellation);
            var wait = NextDueDate() is { } due ? due - time.GetUtcNow() : TimeSpan.FromHours(1);
            wait = TimeSpan.FromSeconds(Math.Clamp(wait.TotalSeconds, 0.5, 3600));
            await SleepAsync(wait, cancellation);
        }
    }

    /// <summary>Sleeps until <paramref name="wait"/> passes or <see cref="Kick"/> is called.</summary>
    private async Task SleepAsync(TimeSpan wait, CancellationToken cancellation)
    {
        Task signal;
        lock (gate)
        {
            // A kick that came while the loop was busy returns at once.
            if (wake.Task.IsCompleted)
            {
                wake = NewWake();
                return;
            }
            signal = wake.Task;
        }
        using var timer = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        try
        {
            await Task.WhenAny(signal, Task.Delay(wait, time, timer.Token));
        }
        finally
        {
            await timer.CancelAsync();
        }
    }

    private static TaskCompletionSource NewWake() => new(TaskCreationOptions.RunContinuationsAsynchronously);
}
