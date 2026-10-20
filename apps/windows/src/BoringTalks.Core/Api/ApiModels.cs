using System.Text.Json.Serialization;

namespace BoringTalks.Core.Api;

// C# mirrors of the zod schemas in packages/shared/src (the API contract).
// Property names become the JSON names through ApiJson's camelCase policy.

/// <summary>A stretch of speech by one speaker. Times are milliseconds from the meeting start.</summary>
public sealed record Segment(string Speaker, int StartMs, int EndMs, string Text);

[JsonConverter(typeof(LenientEnumConverter<MeetingStatus>))]
public enum MeetingStatus
{
    Recording,
    Uploaded,
    Transcribing,
    /// <summary>Also what a status this version doesn't know reads as, so it shows as "processing".</summary>
    Summarizing,
    Ready,
    Failed,
}

[JsonConverter(typeof(LenientEnumConverter<MeetingSource>))]
public enum MeetingSource
{
    /// <summary>A source this version doesn't know yet, so a newer server never breaks the meeting list.</summary>
    Unknown,
    Macos,
    Windows,
    Browser,
    Upload,
    Demo,
}

public static class MeetingStatusText
{
    public static string Title(this MeetingStatus status) => status switch
    {
        MeetingStatus.Recording => "Recording",
        MeetingStatus.Uploaded => "Uploaded",
        MeetingStatus.Transcribing => "Transcribing",
        MeetingStatus.Summarizing => "Summarizing",
        MeetingStatus.Ready => "Ready",
        _ => "Failed",
    };

    /// <summary>Still being worked on by the server.</summary>
    public static bool IsProcessing(this MeetingStatus status) => status is not (MeetingStatus.Ready or MeetingStatus.Failed);
}

public sealed record MeetingListItem
{
    public required string Id { get; init; }
    public required string Title { get; init; }
    public string? Description { get; init; }
    public MeetingStatus Status { get; init; }
    public MeetingSource Source { get; init; }
    public DateTimeOffset StartedAt { get; init; }
    public int? DurationSec { get; init; }
    public IReadOnlyList<string> Speakers { get; init; } = [];
    public IReadOnlyList<string> Topics { get; init; } = [];
    public int ActionItemCount { get; init; }
    public bool HasAudio { get; init; }
}

public sealed record MeetingPage(IReadOnlyList<MeetingListItem> Items, string? NextCursor);

public sealed record CreateMeetingRequest(string? Title, DateTimeOffset? StartedAt, string? Language)
{
    public MeetingSource Source { get; init; } = MeetingSource.Windows;
}

/// <summary>The part of the created meeting the app needs.</summary>
public sealed record CreatedMeeting(string Id);

/// <param name="Channels">"mic-system": the microphone on the left, the PC's sound on the right (shared <c>AudioChannels</c>); null: one mix.</param>
public sealed record UploadUrlRequest(int SizeBytes, string ContentType = "audio/mp4", string? Channels = null);

/// <summary>The shared <c>AudioChannels</c> values.</summary>
public static class AudioChannelLayouts
{
    /// <summary>The microphone (the user) on the left channel, what the PC played (everyone else) on the right.</summary>
    public const string MicSystem = "mic-system";
}

public sealed record UploadUrlResponse(Uri Url, string Key, IReadOnlyDictionary<string, string> Headers, int ExpiresInSec);

public sealed record TranscriptUpload(string? Language, int? DurationSec, IReadOnlyList<Segment> Segments);

public sealed record CompleteMeetingRequest(int? DurationSec);

public sealed record DeviceTokenRequest(string Code, string CodeVerifier);

public sealed record DeviceTokenUser(string? Email, string? Name);

public sealed record DeviceTokenResponse(string Token, string DeviceId, DeviceTokenUser User);

/// <summary>The signed-in account (<c>GET /me</c>): the part the app needs.</summary>
public sealed record Me
{
    public required string Id { get; init; }
    public string? Email { get; init; }
    public string? Name { get; init; }

    /// <summary>Seconds; null = no limit; missing (Undefined) from an API older than limits.</summary>
    public System.Text.Json.JsonElement RecordingLimitSec { get; init; }

    /// <summary>The recording limit in minutes (0 = none), or <paramref name="fallback"/> when the API doesn't say.</summary>
    public int RecordingLimitMinutes(int fallback) => RecordingLimitSec.ValueKind switch
    {
        System.Text.Json.JsonValueKind.Number => Math.Max(1, (int)Math.Round(RecordingLimitSec.GetDouble() / 60)),
        System.Text.Json.JsonValueKind.Null => 0,
        _ => fallback,
    };
}

public sealed record ApiIssue(string Path, string Message);

/// <summary>Error body of every API response.</summary>
public sealed record ApiErrorBody(int StatusCode, string Message, IReadOnlyList<ApiIssue>? Issues);

[JsonConverter(typeof(LenientEnumConverter<ProblemReportKind>))]
public enum ProblemReportKind
{
    /// <summary>The user chose Report a Problem….</summary>
    User,
    /// <summary>The app noticed it had stopped responding.</summary>
    Hang,
}

/// <param name="Flavor">"release" or "dev", like the shared <c>DeviceApp</c>.</param>
public sealed record ProblemReportApp(string Version, string Build, string Flavor);

/// <param name="Os">"Windows 11 Pro 24H2 (10.0.26100)".</param>
/// <param name="Model">The PC's maker and model, "LENOVO 21HM".</param>
public sealed record ProblemReportSystem(string Os, string Model);

/// <summary><c>POST /reports</c>: what the user wrote, what the app knows about itself, and its own recent log.</summary>
public sealed record ProblemReportRequest(
    ProblemReportKind Kind,
    string Message,
    ProblemReportApp App,
    ProblemReportSystem System,
    IReadOnlyDictionary<string, string> Diagnostics,
    string Log);

public sealed record ProblemReportResponse(string Id, DateTimeOffset ReceivedAt);

/// <summary>Contract limits from packages/shared.</summary>
public static class ApiLimits
{
    public const int MaxSegments = 20_000;
    public const int MaxSegmentText = 10_000;
    public const int MaxSpeakerLength = 80;
    public const int MaxTitleLength = 120;
    public const long MaxAudioBytes = 200L * 1024 * 1024;
}
