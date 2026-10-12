using System.Collections.Concurrent;
using BoringTalks.Core.Speech;

namespace BoringTalks.Core.Tests;

/// <summary>"Transcribes" by describing what it heard: how long, and how high the voice was.</summary>
internal sealed class FakeRecognizer(bool fail = false) : IPhraseRecognizer
{
    public ConcurrentQueue<int> Calls { get; } = new();
    public string Name => "fake";
    public int MinimumPreview => PhraseTranscriber.Rate * 6 / 10;

    public Task<string> TranscribeAsync(float[] samples, string? language, CancellationToken cancellation = default)
    {
        Calls.Enqueue(samples.Length);
        if (fail) throw new InvalidOperationException("model crashed");
        var pitch = Pitch.Median(samples);
        return Task.FromResult(pitch is null ? "" : pitch < 180 ? "low words" : "high words");
    }
}

/// <summary>Turns are the whole phrase; the "embedding" says whether the voice is low or high.</summary>
internal sealed class FakeAnalyzer : IVoiceAnalyzer
{
    public Task<IReadOnlyList<VoiceTurn>> TurnsAsync(float[] phrase, CancellationToken cancellation = default) =>
        Task.FromResult<IReadOnlyList<VoiceTurn>>([new VoiceTurn(0, phrase.Length)]);

    public Task<float[]?> EmbeddingAsync(ReadOnlyMemory<float> samples, CancellationToken cancellation = default)
    {
        var pitch = Pitch.Median(samples.Span);
        return Task.FromResult<float[]?>(pitch is null ? null : pitch < 180 ? [1, 0.05f] : [0.05f, 1]);
    }
}

public sealed class PhraseTranscriberTests
{
    private readonly ConcurrentQueue<PhraseEvent> events = new();
    private readonly ConcurrentQueue<string> traces = new();

    private PhraseTranscriber Make(IPhraseRecognizer? recognizer = null, bool voices = false) =>
        new(recognizer ?? new FakeRecognizer(), "en", events.Enqueue,
            voices ? new VoiceRegistry() : null, voices ? new FakeAnalyzer() : null,
            tick: TimeSpan.FromMilliseconds(2), trace: traces.Enqueue);

    /// <summary>
    /// Feeds 0.1 s at a time and lets the transcriber's loop look at each chunk before the next,
    /// as with live audio (however slow the machine, or the coverage instrumentation, is).
    /// </summary>
    private static async Task FeedLive(PhraseTranscriber transcriber, float[] audio)
    {
        const int chunk = PhraseTranscriber.Rate / 10;
        for (var at = 0; at < audio.Length; at += chunk)
        {
            transcriber.Feed(audio.AsSpan(at, Math.Min(chunk, audio.Length - at)));
            var seen = transcriber.Rounds;
            while (transcriber.Rounds < seen + 2) await Task.Delay(1, TestContext.Current.CancellationToken);
        }
    }

    private List<PhraseEvent> Finals => [.. events.Where(e => e.IsFinal && e.Text.Length > 0).OrderBy(e => e.Start)];

    [Fact]
    public async Task Finishes_a_phrase_at_a_pause_with_its_time()
    {
        await using var transcriber = Make();
        await FeedLive(transcriber, [.. Signal.Silence(0.5), .. Signal.Voice(140, 2), .. Signal.Silence(1.2)]);
        await transcriber.FinishAsync();
        var final = Assert.Single(Finals);
        Assert.Equal("low words", final.Text);
        Assert.Null(final.Speaker);
        // Starts about where the voice did (minus a tenth of a second), ends 0.3 s after it.
        Assert.InRange(final.Start / 16000.0, 0.3, 0.55);
        Assert.InRange(final.End / 16000.0, 2.4, 2.9);
        // It was previewed while being said.
        Assert.Contains(events, e => !e.IsFinal && e.Text == "low words");
    }

    [Fact]
    public async Task Silence_alone_says_nothing()
    {
        await using var transcriber = Make();
        transcriber.Feed(Signal.Silence(5));
        transcriber.Feed([]);
        await transcriber.FinishAsync();
        Assert.Empty(Finals);
    }

    [Fact]
    public async Task Cuts_non_stop_talk_every_15_seconds()
    {
        var recognizer = new FakeRecognizer();
        await using var transcriber = Make(recognizer);
        var audio = Signal.Voice(140, 20);
        for (var at = 0; at < audio.Length; at += 1600) transcriber.Feed(audio.AsSpan(at, 1600));
        await transcriber.FinishAsync();
        Assert.Equal(2, Finals.Count);
        Assert.All(recognizer.Calls, length => Assert.True(length <= 15 * 16000 + 1600));
    }

    [Fact]
    public async Task A_failing_model_gives_empty_text_instead_of_stopping()
    {
        await using var transcriber = Make(new FakeRecognizer(fail: true));
        transcriber.Feed([.. Signal.Voice(140, 1), .. Signal.Silence(1)]);
        await transcriber.FinishAsync();
        Assert.Contains(events, e => e.IsFinal && e.Text == "");
        Assert.Contains(traces, t => t.Contains("model crashed", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Tells_speakers_apart_phrase_by_phrase()
    {
        await using var transcriber = Make(voices: true);
        await FeedLive(transcriber, [.. Signal.Voice(120, 2.5), .. Signal.Silence(1), .. Signal.Voice(240, 2.5), .. Signal.Silence(1), .. Signal.Voice(120, 2), .. Signal.Silence(1)]);
        await transcriber.FinishAsync();
        var finals = Finals;
        Assert.Equal(["low words", "high words", "low words"], finals.Select(f => f.Text));
        Assert.Equal([1, 2, 1], finals.Select(f => f.Speaker?.Voice));
        Assert.Equal([0, 1, 2], finals.Select(f => f.Phrase));
    }

    [Fact]
    public async Task Cuts_a_phrase_where_the_pitch_jumps_to_another_voice()
    {
        await using var transcriber = Make(voices: true);
        // No pause between them: only the pitch says someone else took over.
        await FeedLive(transcriber, [.. Signal.Voice(110, 3), .. Signal.Voice(250, 3), .. Signal.Silence(1)]);
        await transcriber.FinishAsync();
        Assert.Contains(traces, t => t.StartsWith("cut by pitch", StringComparison.Ordinal));
        var finals = Finals;
        Assert.Equal(["low words", "high words"], finals.Select(f => f.Text));
        Assert.NotEqual(finals[0].Speaker?.Voice, finals[1].Speaker?.Voice);
    }

    [Fact]
    public async Task Disposing_stops_it_at_once()
    {
        var transcriber = Make();
        transcriber.Feed(Signal.Voice(140, 3));
        await transcriber.DisposeAsync();
        Assert.Empty(Finals);
    }

    [Fact]
    public void The_pitch_track_notices_a_jump_and_ignores_intonation()
    {
        var track = new PhraseTranscriber.PitchTrack();
        track.Extend([.. Signal.Voice(120, 2), .. Signal.Voice(130, 0.8)]);
        Assert.Null(track.Change());
        Assert.NotNull(track.Recent);

        var jump = new PhraseTranscriber.PitchTrack();
        jump.Extend([.. Signal.Voice(120, 2), .. Signal.Voice(250, 0.8)]);
        Assert.Equal(5 * PhraseTranscriber.PitchTrack.Window, jump.Change());

        var tooShort = new PhraseTranscriber.PitchTrack();
        tooShort.Extend(Signal.Voice(120, 1));
        Assert.Null(tooShort.Change());
        Assert.Null(tooShort.Recent);
    }
}
