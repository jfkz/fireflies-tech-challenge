using BoringTalks.Core.Speech;

namespace BoringTalks.Core.Tests;

public sealed class PitchTests
{
    [Theory]
    [InlineData(110)]
    [InlineData(150)]
    [InlineData(220)]
    public void Finds_the_fundamental_of_a_voice(double hz) => Assert.Equal((float)hz, Pitch.Median(Signal.Voice(hz, 1))!.Value, (float)hz * 0.04f);

    [Fact]
    public void Says_nothing_for_silence_or_too_little_audio()
    {
        Assert.Null(Pitch.Median(Signal.Silence(1)));
        Assert.Null(Pitch.Median(Signal.Voice(150, 0.03)));
    }
}

public sealed class VoiceTraitsTests
{
    [Fact]
    public void Measures_how_a_voice_sounds()
    {
        var low = VoiceTraits.Measure(Signal.Voice(110, 2))!;
        var high = VoiceTraits.Measure(Signal.Voice(230, 2))!;
        Assert.Equal(110, low.Pitch!.Value, 6f);
        Assert.Equal(230, high.Pitch!.Value, 12f);
        Assert.True(low.VoicedFrames > 50);
        Assert.Equal(VoiceTraits.Coefficients, low.Timbre.Length);
        Assert.True(high.Brightness > low.Brightness);
        var gaps = low.Gaps(high);
        Assert.Equal(5, gaps.Length);
        Assert.InRange(gaps[0], 11, 14); // about an octave
        Assert.Null(VoiceTraits.Measure(Signal.Silence(1)));
        Assert.Null(VoiceTraits.Measure(Signal.Voice(110, 0.02)));
    }

    [Fact]
    public void Merging_weights_by_how_much_was_heard()
    {
        var a = new VoiceTraits { Pitch = 100, PitchRange = 2, Timbre = [1, 1], Brightness = 400, Breathiness = 0.1f, VoicedFrames = 30 };
        var b = new VoiceTraits { Pitch = 200, PitchRange = null, Timbre = [3, 3], Brightness = 800, Breathiness = 0.2f, VoicedFrames = 10 };
        var merged = a.Merge(b);
        Assert.Equal(40, merged.VoicedFrames);
        Assert.Equal(2, merged.PitchRange);
        Assert.Equal(1.5f, merged.Timbre[0], 1e-5f);
        Assert.Equal(500, merged.Brightness, 1e-3f);
        Assert.Equal(118.9f, merged.Pitch!.Value, 0.1f);
        var nothing = new VoiceTraits();
        Assert.Same(nothing, nothing.Merge(new VoiceTraits()));
    }

    [Fact]
    public void The_fft_matches_a_known_spectrum()
    {
        var data = Enumerable.Range(0, 8).Select(i => new System.Numerics.Complex(Math.Cos(2 * Math.PI * i / 8), 0)).ToArray();
        Fft.Transform(data);
        Assert.Equal(4, data[1].Real, 6);
        Assert.Equal(4, data[7].Real, 6);
        Assert.Equal(0, data[0].Magnitude, 6);
        Assert.Throws<ArgumentException>(() => Fft.Transform(new System.Numerics.Complex[6]));
    }
}

public sealed class VoiceRegistryTests
{
    private static readonly VoiceTraits Speech = new() { Pitch = 150, VoicedFrames = 80 };
    private static readonly VoiceTraits Laugh = new() { Pitch = 300, VoicedFrames = 10 };

    private static float[] Direction(params float[] v) => v;

    [Fact]
    public void Remembers_voices_and_recognizes_them_again()
    {
        var registry = new VoiceRegistry();
        var anna = registry.Identify(new VoiceSample(Direction(1, 0, 0), Speech));
        var ben = registry.Identify(new VoiceSample(Direction(0, 1, 0), Speech));
        Assert.Equal(1, anna.Voice);
        Assert.Equal(2, ben.Voice);
        Assert.Equal(1, registry.Identify(new VoiceSample(Direction(0.95f, 0.1f, 0), Speech)).Voice);
        Assert.Equal(2, registry.Match(new VoiceSample(Direction(0.1f, 1, 0), Speech)).Voice);
        Assert.Equal(2, registry.Count);
        Assert.Contains("150 Hz", anna.Description);
    }

    [Fact]
    public void A_laugh_neither_starts_nor_changes_a_voice()
    {
        var registry = new VoiceRegistry();
        Assert.Null(registry.Identify(new VoiceSample(Direction(1, 0, 0), Laugh)).Voice);
        registry.Identify(new VoiceSample(Direction(1, 0, 0), Speech));
        // Far from everyone, but too short to be someone new: the nearest voice.
        Assert.Equal(1, registry.Identify(new VoiceSample(Direction(0, 0, 1), Laugh)).Voice);
        Assert.Equal(1, registry.Count);
    }

    [Fact]
    public void Someone_new_while_still_speaking_is_unfamiliar()
    {
        var registry = new VoiceRegistry();
        Assert.False(registry.Match(new VoiceSample(Direction(1, 0), Speech)).Unfamiliar);
        registry.Identify(new VoiceSample(Direction(1, 0), Speech));
        var stranger = registry.Match(new VoiceSample(Direction(0, 1), Speech));
        Assert.Null(stranger.Voice);
        Assert.True(stranger.Unfamiliar);
        Assert.False(registry.Match(new VoiceSample(Direction(0, 1), Laugh)).Unfamiliar);
    }

    [Fact]
    public void Stops_adding_voices_at_the_cap()
    {
        var registry = new VoiceRegistry(maxVoices: 2);
        registry.Identify(new VoiceSample(Direction(1, 0, 0), Speech));
        registry.Identify(new VoiceSample(Direction(0, 1, 0), Speech));
        Assert.NotNull(registry.Identify(new VoiceSample(Direction(0, 0, 1), Speech)).Voice);
        Assert.Equal(2, registry.Count);
    }

    [Fact]
    public void A_voice_learns_from_confident_phrases()
    {
        var registry = new VoiceRegistry();
        registry.Identify(new VoiceSample(Direction(1, 0), Speech));
        for (var i = 0; i < 40; i++) registry.Identify(new VoiceSample(Direction(1, 0.5f), Speech with { Pitch = 160 }));
        // It drifted toward the newer phrases, so they now match closely.
        Assert.Equal(1, registry.Match(new VoiceSample(Direction(1, 0.55f), Speech)).Voice);
    }

    [Fact]
    public void Distances_are_cosine()
    {
        Assert.Equal(0, VoiceRegistry.Distance([2, 0], [5, 0]), 1e-6f);
        Assert.Equal(1, VoiceRegistry.Distance([1, 0], [0, 3]), 1e-6f);
        Assert.Equal(2, VoiceRegistry.Distance([1, 0], [-1, 0]), 1e-6f);
    }

    [Theory]
    [InlineData(100f, 2f, 300f, 0.05f, "deep 100 Hz · flat · dark · clear")]
    [InlineData(150f, 3f, 450f, 0.08f, "low 150 Hz · even · warm · soft")]
    [InlineData(200f, 5f, 600f, 0.1f, "high 200 Hz · lively · bright · breathy")]
    [InlineData(250f, 5f, 600f, 0.1f, "very high 250 Hz · lively · bright · breathy")]
    public void Describes_how_a_voice_sounds(float pitch, float range, float brightness, float breathiness, string text) =>
        Assert.Equal(text, VoiceRegistry.Describe(new VoiceTraits { Pitch = pitch, PitchRange = range, Brightness = brightness, Breathiness = breathiness }));

    [Fact]
    public void Describes_a_voice_without_pitch() => Assert.Equal("dark · clear", VoiceRegistry.Describe(new VoiceTraits()));
}

public sealed class VoiceTurnsTests
{
    private const int Rate = 16000;

    [Fact]
    public void Cuts_between_speakers_halfway_through_the_gap()
    {
        var turns = VoiceTurns.FromSpans([new(0, 0.1f, 2.0f), new(1, 2.4f, 4.0f)], 4 * Rate);
        Assert.Equal([new VoiceTurn(0, (int)(2.2 * Rate)), new VoiceTurn((int)(2.2 * Rate), 4 * Rate)], turns);
    }

    [Fact]
    public void Folds_short_turns_into_a_neighbour_and_merges_the_same_speaker()
    {
        var turns = VoiceTurns.FromSpans([new(0, 0, 2), new(1, 2, 2.5f), new(0, 2.5f, 5)], 5 * Rate);
        Assert.Equal([new VoiceTurn(0, 5 * Rate)], turns);
        var first = VoiceTurns.FromSpans([new(1, 0, 0.5f), new(0, 0.5f, 3)], 3 * Rate);
        Assert.Equal([new VoiceTurn(0, 3 * Rate)], first);
    }

    [Fact]
    public void Ignores_spans_past_the_phrase_and_keeps_the_whole_phrase_without_any()
    {
        Assert.Equal([new VoiceTurn(0, Rate)], VoiceTurns.FromSpans([], Rate));
        Assert.Equal([new VoiceTurn(0, Rate)], VoiceTurns.FromSpans([new(0, 1.5f, 3)], Rate));
        Assert.Equal([new VoiceTurn(0, 0)], VoiceTurns.FromSpans([new(0, 0, 1)], 0));
    }

    [Fact]
    public void Repeats_a_short_phrase_to_fill_the_diarizer_window()
    {
        var phrase = new float[Rate * 5];
        phrase[0] = 1;
        var padded = VoiceTurns.Padded(phrase);
        Assert.True(padded.Length >= VoiceTurns.MinimumDiarizedSamples);
        Assert.Equal(1, padded[Rate * 5]);
        var longPhrase = new float[VoiceTurns.MinimumDiarizedSamples];
        Assert.Same(longPhrase, VoiceTurns.Padded(longPhrase));
        Assert.True(new VoiceTurn(3, 3).IsEmpty);
        Assert.Equal(2, new VoiceTurn(1, 3).Length);
    }
}
