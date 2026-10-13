using System.Text.Json;
using System.Text.Json.Serialization;
using BoringTalks.Core.Api;

namespace BoringTalks.Core.Uploads;

/// <summary>Where the upload has got to. Each step is safe to repeat.</summary>
[JsonConverter(typeof(LenientEnumConverter<UploadStep>))]
public enum UploadStep
{
    /// <summary><c>POST /meetings</c> (skipped once the server id is known).</summary>
    Create,
    /// <summary><c>POST /meetings/:id/upload-url</c>, then PUT the file to storage.</summary>
    Audio,
    /// <summary><c>PUT /meetings/:id/transcript</c> (replaces, so repeating is harmless).</summary>
    Transcript,
    /// <summary><c>POST /meetings/:id/complete</c> (409 = already completed = fine).</summary>
    Complete,
    Done,
}

/// <summary>
/// A finished recording on its way to the server. Persisted, so an upload
/// survives going offline, quitting and relaunching.
/// </summary>
public sealed record PendingMeeting
{
    /// <summary>Local id; also the idempotency key of <c>POST /meetings</c> and the audio file name.</summary>
    public Guid Id { get; init; } = Guid.NewGuid();
    public string? Title { get; init; }
    public DateTimeOffset StartedAt { get; init; }
    public int DurationSec { get; init; }
    public string? Language { get; init; }
    public IReadOnlyList<Segment> Segments { get; init; } = [];
    /// <summary>File name in the Recordings folder, if audio was recorded.</summary>
    public string? AudioFileName { get; init; }
    /// <summary>The user's "Upload audio" setting at the time of recording.</summary>
    public bool UploadAudio { get; init; }
    /// <summary>
    /// <see cref="Api.AudioChannelLayouts.MicSystem"/> when recorded for the server to transcribe (each
    /// side on its own channel, no transcript); null for one mix.
    /// </summary>
    public string? AudioChannels { get; init; }
    public string? RemoteId { get; init; }
    public UploadStep Step { get; init; } = UploadStep.Create;
    /// <summary>Failed for good (the server refused it); waits for the user to retry or discard.</summary>
    public bool IsFailed { get; init; }
    /// <summary>Failed attempts in a row at the current step.</summary>
    public int Attempts { get; init; }
    public DateTimeOffset? NextAttemptAt { get; init; }
    public string? LastError { get; init; }

    /// <summary>
    /// Audio goes up when the user wants it kept, and always when there is no
    /// transcript: then the server transcribes it instead.
    /// </summary>
    public bool SendsAudio(bool fileExists) => AudioFileName is not null && fileExists && (UploadAudio || Segments.Count == 0);

    /// <summary>The step after <paramref name="step"/>, skipping the ones with nothing to do.</summary>
    public UploadStep StepAfter(UploadStep step, bool audioExists)
    {
        var next = step;
        while (next != UploadStep.Done)
        {
            next = next switch
            {
                UploadStep.Create => UploadStep.Audio,
                UploadStep.Audio => UploadStep.Transcript,
                UploadStep.Transcript => UploadStep.Complete,
                _ => UploadStep.Done,
            };
            if (next == UploadStep.Audio && !SendsAudio(audioExists)) continue;
            if (next == UploadStep.Transcript && Segments.Count == 0) continue;
            return next;
        }
        return UploadStep.Done;
    }

    /// <summary>Something to upload at all: a transcript, or audio for the server to transcribe.</summary>
    public bool HasContent(bool audioExists) => Segments.Count > 0 || SendsAudio(audioExists);
}

/// <summary>Where the queue is kept between launches.</summary>
public interface IUploadStore
{
    IReadOnlyList<PendingMeeting> Load();
    void Save(IReadOnlyList<PendingMeeting> items);
}

/// <summary>A JSON file in %APPDATA%\BoringTalks, replaced in one move so a crash never leaves half a file.</summary>
public sealed class FileUploadStore(string path) : IUploadStore
{
    public string Path { get; } = path;

    public IReadOnlyList<PendingMeeting> Load()
    {
        if (!File.Exists(Path)) return [];
        return JsonSerializer.Deserialize<List<PendingMeeting>>(File.ReadAllBytes(Path), ApiJson.Options) ?? [];
    }

    public void Save(IReadOnlyList<PendingMeeting> items)
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path)!);
        var temporary = Path + ".tmp";
        File.WriteAllBytes(temporary, JsonSerializer.SerializeToUtf8Bytes(items, ApiJson.Options));
        File.Move(temporary, Path, overwrite: true);
    }
}

public sealed class InMemoryUploadStore(IEnumerable<PendingMeeting>? items = null) : IUploadStore
{
    private List<PendingMeeting> items = [.. items ?? []];
    private readonly Lock gate = new();

    public int Saves { get; private set; }

    public IReadOnlyList<PendingMeeting> Load()
    {
        lock (gate) return [.. items];
    }

    public void Save(IReadOnlyList<PendingMeeting> items)
    {
        lock (gate)
        {
            this.items = [.. items];
            Saves++;
        }
    }
}

/// <summary>Wait before retrying: 5 s, 10 s, 20 s… up to 15 minutes.</summary>
public sealed record Backoff(double BaseSeconds = 5, double MaximumSeconds = 15 * 60)
{
    public TimeSpan Delay(int attempts)
    {
        if (attempts <= 0) return TimeSpan.Zero;
        var exponent = Math.Min(attempts - 1, 30);
        return TimeSpan.FromSeconds(Math.Min(BaseSeconds * Math.Pow(2, exponent), MaximumSeconds));
    }
}
