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

public sealed record ApiIssue(string Path, string Message);

/// <summary>Error body of every API response.</summary>
public sealed record ApiErrorBody(int StatusCode, string Message, IReadOnlyList<ApiIssue>? Issues);

/// <summary>Contract limits from packages/shared.</summary>
public static class ApiLimits
{
    public const int MaxSegments = 20_000;
    public const int MaxSegmentText = 10_000;
    public const int MaxSpeakerLength = 80;
    public const int MaxTitleLength = 120;
    public const long MaxAudioBytes = 200L * 1024 * 1024;
}
