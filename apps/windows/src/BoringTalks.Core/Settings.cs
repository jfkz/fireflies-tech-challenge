using System.Text.Json;
using System.Text.Json.Serialization;

namespace BoringTalks.Core;

/// <summary>User settings, kept in <c>%APPDATA%\BoringTalks\settings.json</c>. Same keys and defaults as the Mac app.</summary>
public sealed record Settings
{
    /// <summary>
    /// Transcribe on this PC as the meeting goes (the speech model, ~700 MB). Off: upload only — each
    /// side on its own channel, and the server transcribes after the meeting (the Mac's "Online").
    /// </summary>
    public bool TranscribeOnPc { get; init; } = true;

    /// <summary>ISO code the speech model is steered to; empty means detect it.</summary>
    public string Language { get; init; } = "";

    /// <summary>
    /// Upload the meeting audio too (the dashboard can then play it back). Without a
    /// local transcript the audio goes up anyway, for the server to transcribe.
    /// </summary>
    public bool UploadAudio { get; init; } = true;

    /// <summary>Days a recording stays on this PC after it has uploaded; 0 deletes it at once.</summary>
    public int KeepAudioDays { get; init; } = 7;

    /// <summary>
    /// Record "You" with the PC's own microphone when the default microphone is a
    /// Bluetooth headset, so the headset doesn't drop to call quality while recording.
    /// </summary>
    public bool AvoidBluetoothMic { get; init; } = true;

    /// <summary>The microphone that records "You" (a Windows endpoint id); empty: the system default.</summary>
    public string MicrophoneId { get; init; } = "";

    /// <summary>Its name, to show while it isn't connected.</summary>
    public string MicrophoneName { get; init; } = "";

    /// <summary>Stop the recording when nobody has spoken for this many minutes; 0 never stops.</summary>
    public int SilenceStopMinutes { get; init; } = 5;

    /// <summary>Ask to record when a call app (Zoom, Teams, a browser…) starts using the microphone.</summary>
    public bool OfferToRecordCalls { get; init; } = true;

    /// <summary>Stop the recording shortly after the call's app releases the microphone.</summary>
    public bool StopWhenCallEnds { get; init; } = true;

    /// <summary>Call apps (by name) never to ask about.</summary>
    public IReadOnlyList<string> IgnoredCallApps { get; init; } = [];

    /// <summary>Executable names of call apps BoringTalks doesn't know, added by hand.</summary>
    public IReadOnlyList<string> ExtraCallApps { get; init; } = [];

    /// <summary>Start BoringTalks when you sign in to Windows, so it can offer to record calls.</summary>
    public bool OpenAtSignIn { get; init; } = true;

    /// <summary>The Settings tab last open: transcription, recording, calls or account.</summary>
    public string SettingsTab { get; init; } = "transcription";

    /// <summary>The API to use instead of production (dev and QA).</summary>
    public string? ApiUrl { get; init; }

    /// <summary>The dashboard to use instead of production.</summary>
    public string? WebUrl { get; init; }

    [JsonIgnore]
    public string? LanguageCode => string.IsNullOrWhiteSpace(Language) ? null : Language;

    /// <summary>The usual "stop after silence" choices, plus a value set by hand that isn't one of them.</summary>
    public static IReadOnlyList<int> SilenceChoices(int current)
    {
        int[] choices = [1, 2, 5, 10, 15, 30, 60];
        return current > 0 && !choices.Contains(current) ? [.. choices.Append(current).Order()] : choices;
    }
}

/// <summary>Reads and writes <see cref="Settings"/>; a missing or damaged file means the defaults.</summary>
public sealed class JsonSettingsStore(string path)
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public string Path { get; } = path;

    public Settings Load()
    {
        try
        {
            if (!File.Exists(Path)) return new Settings();
            var settings = JsonSerializer.Deserialize<Settings>(File.ReadAllText(Path), Options) ?? new Settings();
            return settings with
            {
                KeepAudioDays = Math.Max(0, settings.KeepAudioDays),
                SilenceStopMinutes = Math.Max(0, settings.SilenceStopMinutes),
                IgnoredCallApps = settings.IgnoredCallApps ?? [],
                ExtraCallApps = settings.ExtraCallApps ?? [],
            };
        }
        catch (Exception error) when (error is JsonException or IOException or UnauthorizedAccessException)
        {
            return new Settings();
        }
    }

    public void Save(Settings settings)
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path)!);
        var temporary = Path + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(settings, Options));
        File.Move(temporary, Path, overwrite: true);
    }
}
