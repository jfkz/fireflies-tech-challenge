namespace BoringTalks.Core.Transcript;

/// <summary>
/// What the live transcript window shows: finished phrases with speaker labels,
/// plus the phrase each side is saying right now. Not thread-safe: the app feeds it
/// on the UI thread.
/// </summary>
public sealed class LiveTranscript(TimeProvider? time = null)
{
    public sealed record Line(Guid Id, string Speaker, AudioChannel Channel, string Text, bool IsFinal, int StartMs);

    public const int Keep = 300;

    private readonly TimeProvider time = time ?? TimeProvider.System;
    private readonly List<Line> lines = [];
    private readonly Dictionary<AudioChannel, Line> previews = [];
    private readonly Dictionary<AudioChannel, long> lastWords = [];
    private SpeakerLabeler labeler = new();
    /// <summary>The last speaker heard on system audio, for words whose voice isn't known yet.</summary>
    private string? lastSystemSpeaker;

    public IReadOnlyList<Line> Lines => lines;
    public IReadOnlyDictionary<AudioChannel, Line> Previews => previews;

    /// <summary>Raised after every change.</summary>
    public event Action? Changed;

    /// <summary>Seconds since <paramref name="channel"/> last got words; drives the cartoon heads.</summary>
    public double SinceSpeech(AudioChannel channel) =>
        lastWords.TryGetValue(channel, out var at) ? time.GetElapsedTime(at).TotalSeconds : 1000;

    public void Reset()
    {
        lines.Clear();
        previews.Clear();
        lastWords.Clear();
        labeler = new SpeakerLabeler();
        lastSystemSpeaker = null;
        Changed?.Invoke();
    }

    public void Receive(string text, bool isFinal, AudioChannel channel, int? voice, int startMs)
    {
        var label = labeler.Label(channel, voice)
            ?? lastSystemSpeaker ?? (channel == AudioChannel.System ? SpeakerLabeler.Others : SpeakerLabeler.You);
        if (channel == AudioChannel.System && voice is not null) lastSystemSpeaker = label;
        var trimmed = text.Trim();
        if (isFinal)
        {
            previews.Remove(channel);
            if (trimmed.Length == 0)
            {
                Changed?.Invoke();
                return;
            }
            lines.Add(new Line(Guid.NewGuid(), label, channel, trimmed, true, startMs));
            if (lines.Count > Keep) lines.RemoveRange(0, lines.Count - Keep);
        }
        else
        {
            if (trimmed.Length == 0) return;
            var id = previews.TryGetValue(channel, out var existing) ? existing.Id : Guid.NewGuid();
            previews[channel] = new Line(id, label, channel, trimmed, false, startMs);
        }
        lastWords[channel] = time.GetTimestamp();
        Changed?.Invoke();
    }

    /// <summary>Sample lines for <c>--demo</c> and screenshots.</summary>
    public void ShowDemo()
    {
        Reset();
        (AudioChannel Channel, int? Voice, string Text)[] script =
        [
            (AudioChannel.System, 1, "Okay, let's start. Can everyone see my screen?"),
            (AudioChannel.Microphone, null, "Yes, we can see it. Go ahead."),
            (AudioChannel.System, 2, "Quick update on pricing: we're moving Pro to twenty-nine dollars."),
            (AudioChannel.System, 1, "When does that go live?"),
            (AudioChannel.System, 2, "November third, if legal signs off this week."),
            (AudioChannel.Microphone, null, "I'll ping legal today and send the draft to everyone."),
        ];
        for (var i = 0; i < script.Length; i++) Receive(script[i].Text, true, script[i].Channel, script[i].Voice, i * 4200);
        Receive("Great, so the next step is the", false, AudioChannel.System, 1, 27000);
    }
}
