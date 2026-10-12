namespace BoringTalks.Core.Speech;

/// <summary>Who said a phrase, as far as the transcriber can tell.</summary>
public sealed record SpeakerTag
{
    /// <summary>Stable id of a recognized voice; null while it isn't known yet.</summary>
    public int? Voice { get; init; }
    /// <summary>How the voice sounds, e.g. "high 205 Hz · lively · warm · clear".</summary>
    public string? Description { get; init; }
    /// <summary>Which phrase the text belongs to; a phrase is finished in the background while the next one is already shown.</summary>
    public int? Phrase { get; init; }
    /// <summary>Pitch of the words themselves (Hz), known at once, while the voice may not be.</summary>
    public float? Pitch { get; init; }
    /// <summary>Not recognized because it is like no voice heard so far: someone new.</summary>
    public bool Unfamiliar { get; init; }

    public static SpeakerTag Unknown { get; } = new();
}

/// <summary>What is known about one stretch of a voice.</summary>
/// <param name="Embedding">Speaker embedding (WeSpeaker): who it is.</param>
/// <param name="Traits">Pitch, intonation, timbre, brightness, breathiness: how it sounds.</param>
public sealed record VoiceSample(float[] Embedding, VoiceTraits? Traits);

/// <summary>
/// Remembers the voices heard on the call and recognizes them again.
/// <para>
/// Who is who comes from speaker embeddings. On the Mac (WeSpeaker ResNet34 via FluidAudio)
/// the thresholds were fitted on 514 clips of 1.2–5 s from 40 LibriSpeech speakers: a voice
/// is mistaken 3.2 % of the time on one such clip. They are parameters here so they can be
/// fitted again for the embedding model the Windows app runs.
/// </para>
/// <para>For a meeting, voices are never forgotten, so "Speaker 2" stays Speaker 2 for the whole meeting. Thread-safe.</para>
/// </summary>
public sealed class VoiceRegistry(int maxVoices = 10, float sameDistance = VoiceRegistry.DefaultSameDistance, float newDistance = VoiceRegistry.DefaultNewDistance)
{
    /// <summary>Closer than this: surely the same person, and the voice learns from the phrase.</summary>
    public const float DefaultSameDistance = 0.61f;
    /// <summary>Further than this from everyone: a new person. In between: the nearest voice, without learning.</summary>
    public const float DefaultNewDistance = 0.74f;
    /// <summary>A second or so of real speech: less (a laugh, music that came out as words) neither starts nor changes a voice.</summary>
    private const int SpeechFrames = 50;

    private sealed class Voice(int id, float[] sum, VoiceTraits? traits)
    {
        public int Id { get; } = id;
        /// <summary>Sum of the embeddings of its confident phrases; its direction is the voice.</summary>
        public float[] Sum { get; set; } = sum;
        public int Phrases { get; set; } = 1;
        public VoiceTraits? Traits { get; set; } = traits;

        public SpeakerTag Tag => new() { Voice = Id, Description = Traits is null ? null : Describe(Traits) };
    }

    private readonly List<Voice> voices = [];
    private readonly Lock gate = new();
    private int nextId = 1;

    public int Count
    {
        get { lock (gate) return voices.Count; }
    }

    /// <summary>A finished phrase: match its voice or remember a new one.</summary>
    public SpeakerTag Identify(VoiceSample sample)
    {
        lock (gate)
        {
            var unit = Normalized(sample.Embedding);
            var distances = voices.Select(v => Distance(v.Sum, unit)).ToList();
            var nearest = distances.Count == 0 ? -1 : distances.IndexOf(distances.Min());
            var speech = (sample.Traits?.VoicedFrames ?? 0) >= SpeechFrames;
            Voice voice;
            if (nearest >= 0 && (distances[nearest] < newDistance || voices.Count >= maxVoices || !speech))
            {
                voice = voices[nearest];
                if (distances[nearest] < sameDistance && speech) Learn(voice, sample, unit);
            }
            else if (!speech)
            {
                return SpeakerTag.Unknown;
            }
            else
            {
                voice = new Voice(nextId++, unit, sample.Traits);
                voices.Add(voice);
            }
            return voice.Tag;
        }
    }

    /// <summary>A phrase still being heard: the known voice it matches, without learning from it, or an unknown voice.</summary>
    public SpeakerTag Match(VoiceSample sample)
    {
        lock (gate)
        {
            var unit = Normalized(sample.Embedding);
            var nearest = voices.MinBy(v => Distance(v.Sum, unit));
            if (nearest is not null && Distance(nearest.Sum, unit) < newDistance) return nearest.Tag;
            // Someone new only on a second of real speech, not a laugh.
            var speech = (sample.Traits?.VoicedFrames ?? 0) >= SpeechFrames;
            return new SpeakerTag { Unfamiliar = voices.Count > 0 && speech };
        }
    }

    /// <summary>"205 Hz · lively · breathy": how a voice sounds.</summary>
    public static string Describe(VoiceTraits traits)
    {
        var parts = new List<string>();
        if (traits.Pitch is { } pitch)
        {
            var height = pitch < 110 ? "deep" : pitch < 160 ? "low" : pitch < 220 ? "high" : "very high";
            parts.Add($"{height} {(int)pitch} Hz");
        }
        if (traits.PitchRange is { } range) parts.Add(range < 2.75 ? "flat" : range < 4.4 ? "even" : "lively");
        parts.Add(traits.Brightness < 410 ? "dark" : traits.Brightness < 560 ? "warm" : "bright");
        parts.Add(traits.Breathiness < 0.075 ? "clear" : traits.Breathiness < 0.094 ? "soft" : "breathy");
        return string.Join(" · ", parts);
    }

    private static void Learn(Voice voice, VoiceSample sample, float[] unit)
    {
        // Long enough to settle, short enough to follow a voice that changes a bit.
        var keep = (float)Math.Min(voice.Phrases, 30) / voice.Phrases;
        voice.Sum = [.. voice.Sum.Zip(unit, (s, u) => s * keep + u)];
        voice.Phrases++;
        if (sample.Traits is { } traits) voice.Traits = voice.Traits?.Merge(traits) ?? traits;
    }

    internal static float[] Normalized(float[] v)
    {
        double norm = 0;
        foreach (var x in v) norm += x * x;
        var length = (float)Math.Max(Math.Sqrt(norm), 1e-9);
        return [.. v.Select(x => x / length)];
    }

    /// <summary>Cosine distance between two embeddings, normalized or not.</summary>
    public static float Distance(float[] a, float[] b) => DistanceToUnit(a, Normalized(b));

    private static float DistanceToUnit(float[] a, float[] unit)
    {
        double dot = 0, norm = 0;
        for (var i = 0; i < Math.Min(a.Length, unit.Length); i++) dot += a[i] * unit[i];
        foreach (var x in a) norm += x * x;
        return (float)(1 - dot / Math.Max(Math.Sqrt(norm), 1e-9));
    }
}
