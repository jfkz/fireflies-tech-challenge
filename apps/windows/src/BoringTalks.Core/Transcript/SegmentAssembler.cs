using System.Text.RegularExpressions;
using BoringTalks.Core.Api;

namespace BoringTalks.Core.Transcript;

/// <summary>The two sides of a meeting.</summary>
public enum AudioChannel
{
    /// <summary>The microphone: the user.</summary>
    Microphone,
    /// <summary>What the PC plays: everyone else on the call.</summary>
    System,
}

/// <summary>One finished phrase as a transcriber produced it, before speaker labels.</summary>
/// <param name="Voice">The voice the registry recognized (system audio only); null when unknown.</param>
/// <param name="StartMs">Milliseconds from the meeting start.</param>
public sealed record PhraseRecord(AudioChannel Channel, int? Voice, int StartMs, int EndMs, string Text);

/// <summary>
/// Names speakers the way the transcript shows them: the microphone is "You",
/// voices on system audio are "Speaker 1…N" in the order they first spoke.
/// </summary>
public sealed class SpeakerLabeler
{
    public const string You = "You";
    /// <summary>System audio when voices couldn't be told apart at all.</summary>
    public const string Others = "Others";

    private readonly Dictionary<int, int> numbers = [];

    public string? Label(AudioChannel channel, int? voice)
    {
        if (channel == AudioChannel.Microphone) return You;
        if (voice is not { } id) return null;
        if (!numbers.TryGetValue(id, out var number))
        {
            number = numbers.Count + 1;
            numbers[id] = number;
        }
        return $"Speaker {number}";
    }
}

/// <summary>Turns the phrases of both channels into the segments the API takes.</summary>
public static partial class SegmentAssembler
{
    /// <summary>
    /// <list type="bullet">
    /// <item>Orders phrases by time and gives them speaker labels.</item>
    /// <item>A system phrase without a recognized voice (a laugh, a word or two) goes to
    /// the system speaker just before it, else just after, else "Others".</item>
    /// <item>Without headphones the microphone also hears the call: a microphone phrase
    /// that overlaps a system phrase and repeats most of its words is that echo,
    /// and is dropped.</item>
    /// <item>Empty text is dropped, text and speaker names are clipped to the API limits.</item>
    /// </list>
    /// </summary>
    public static IReadOnlyList<Segment> Assemble(IEnumerable<PhraseRecord> phrases, bool dropEcho = true)
    {
        var cleaned = phrases
            .Select(p =>
            {
                var text = Whitespace().Replace(p.Text.Trim(), " ");
                if (text.Length > ApiLimits.MaxSegmentText) text = text[..ApiLimits.MaxSegmentText];
                var start = Math.Max(0, p.StartMs);
                return p with { Text = text, StartMs = start, EndMs = Math.Max(start, p.EndMs) };
            })
            .Where(p => p.Text.Length > 0)
            .OrderBy(p => p.StartMs)
            .ThenBy(p => p.EndMs)
            .ThenBy(p => p.Channel == AudioChannel.System ? 0 : 1)
            .ToList();

        if (dropEcho)
        {
            var system = cleaned.Where(p => p.Channel == AudioChannel.System).ToList();
            cleaned.RemoveAll(p => p.Channel == AudioChannel.Microphone && IsEcho(p, system));
        }

        var labeler = new SpeakerLabeler();
        var labels = cleaned.Select(p => labeler.Label(p.Channel, p.Voice)).ToArray();
        // Unknown system voices borrow the nearest earlier (or later) system speaker.
        var known = Enumerable.Range(0, labels.Length).Where(i => cleaned[i].Channel == AudioChannel.System && labels[i] is not null).ToList();
        var resolved = new string[labels.Length];
        for (var index = 0; index < labels.Length; index++)
        {
            var before = known.LastOrDefault(k => k < index, -1);
            var after = known.FirstOrDefault(k => k > index, -1);
            resolved[index] = labels[index]
                ?? (before >= 0 ? labels[before] : null)
                ?? (after >= 0 ? labels[after] : null)
                ?? SpeakerLabeler.Others;
        }

        return cleaned.Zip(resolved)
            .Take(ApiLimits.MaxSegments)
            .Select(pair => new Segment(Clip(pair.Second, ApiLimits.MaxSpeakerLength), pair.First.StartMs, pair.First.EndMs, pair.First.Text))
            .ToList();
    }

    /// <summary>
    /// The microphone heard the speakers: same time (give or take the 1.5 s the
    /// two transcribers may cut phrases differently) and mostly the same words.
    /// </summary>
    internal static bool IsEcho(PhraseRecord mic, IReadOnlyList<PhraseRecord> system)
    {
        var micWords = Words(mic.Text);
        if (micWords.Count == 0) return false;
        const int slack = 1500;
        var nearby = system.Where(s => s.StartMs <= mic.EndMs + slack && s.EndMs >= mic.StartMs - slack).ToList();
        if (nearby.Count == 0) return false;
        var heard = nearby.SelectMany(s => Words(s.Text)).ToHashSet(StringComparer.Ordinal);
        return (double)micWords.Count(heard.Contains) / micWords.Count >= 0.6;
    }

    internal static List<string> Words(string text) =>
        [.. NonWord().Split(text.ToLowerInvariant()).Where(w => w.Length > 0)];

    private static string Clip(string text, int length) => text.Length > length ? text[..length] : text;

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();

    [GeneratedRegex(@"[^\p{L}\p{N}]+")]
    private static partial Regex NonWord();
}
