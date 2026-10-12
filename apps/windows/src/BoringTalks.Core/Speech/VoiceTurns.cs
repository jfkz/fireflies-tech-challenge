namespace BoringTalks.Core.Speech;

/// <summary>One speaker's stretch of a phrase, in samples of the phrase: [Start, End).</summary>
public readonly record struct VoiceTurn(int Start, int End)
{
    public int Length => End - Start;
    public bool IsEmpty => End <= Start;
}

/// <summary>A diarizer's answer: who spoke from <c>Start</c> to <c>End</c> seconds.</summary>
public readonly record struct SpeakerSpan(int Speaker, float Start, float End);

/// <summary>Who speaks when in a phrase, from the spans a diarizer found.</summary>
public static class VoiceTurns
{
    public const int Rate = 16000;
    /// <summary>The diarizer works on 10 s windows, so a short phrase is repeated to fill 12 s; turns are read from the first copy.</summary>
    public const int MinimumDiarizedSamples = Rate * 12;

    /// <summary>The phrase, repeated until it is long enough for the diarizer.</summary>
    public static float[] Padded(float[] phrase)
    {
        if (phrase.Length == 0 || phrase.Length >= MinimumDiarizedSamples) return phrase;
        var copies = (MinimumDiarizedSamples + phrase.Length - 1) / phrase.Length;
        var padded = new float[phrase.Length * copies];
        for (var i = 0; i < copies; i++) phrase.CopyTo(padded, i * phrase.Length);
        return padded;
    }

    /// <summary>
    /// Turns that together cover the whole phrase. Turns shorter than 0.8 s are folded into a
    /// neighbour; the cut between two turns is halfway through the gap (or overlap) between them.
    /// </summary>
    public static IReadOnlyList<VoiceTurn> FromSpans(IEnumerable<SpeakerSpan> found, int phraseLength)
    {
        var whole = new[] { new VoiceTurn(0, phraseLength) };
        if (phraseLength == 0) return whole;
        var duration = (float)phraseLength / Rate;
        var spans = Merged(found
            .Where(s => s.Start < duration - 0.05f)
            .Select(s => s with { End = Math.Min(s.End, duration) })
            .OrderBy(s => s.Start));
        while (spans.Count > 1 && spans.FindIndex(s => s.End - s.Start < 0.8f) is var shortIndex and >= 0)
        {
            if (shortIndex > 0) spans[shortIndex - 1] = spans[shortIndex - 1] with { End = Math.Max(spans[shortIndex - 1].End, spans[shortIndex].End) };
            else spans[1] = spans[1] with { Start = spans[0].Start };
            spans.RemoveAt(shortIndex);
            spans = Merged(spans);
        }
        if (spans.Count == 0) return whole;

        var turns = new List<VoiceTurn>();
        var start = 0;
        for (var i = 0; i < spans.Count; i++)
        {
            var end = i == spans.Count - 1
                ? phraseLength
                : Math.Min(phraseLength, Math.Max(start, (int)((spans[i].End + spans[i + 1].Start) / 2 * Rate)));
            turns.Add(new VoiceTurn(start, end));
            start = end;
        }
        return [.. turns.Where(t => !t.IsEmpty)];
    }

    private static List<SpeakerSpan> Merged(IEnumerable<SpeakerSpan> spans)
    {
        var result = new List<SpeakerSpan>();
        foreach (var span in spans)
        {
            if (result.Count > 0 && result[^1].Speaker == span.Speaker) result[^1] = result[^1] with { End = Math.Max(result[^1].End, span.End) };
            else result.Add(span);
        }
        return result;
    }
}
