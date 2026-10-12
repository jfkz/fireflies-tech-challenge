namespace BoringTalks.Core.Speech;

/// <summary>A speech model that transcribes a whole phrase at a time.</summary>
public interface IPhraseRecognizer
{
    string Name { get; }
    /// <summary>Shortest phrase (in 16 kHz samples) worth a preview.</summary>
    int MinimumPreview { get; }
    /// <param name="language">An ISO code, or null to detect it.</param>
    Task<string> TranscribeAsync(float[] samples, string? language, CancellationToken cancellation = default);
}

/// <summary>Tells voices apart: splits a phrase into turns, and fingerprints a stretch of one voice.</summary>
public interface IVoiceAnalyzer
{
    /// <summary>Who speaks when; together the turns cover the whole phrase.</summary>
    Task<IReadOnlyList<VoiceTurn>> TurnsAsync(float[] phrase, CancellationToken cancellation = default);
    /// <summary>A speaker embedding of (up to the last 10 s of) the audio; null for too little of it.</summary>
    Task<float[]?> EmbeddingAsync(ReadOnlyMemory<float> samples, CancellationToken cancellation = default);
}

/// <summary>
/// Text from the transcriber: a preview of the phrase still being spoken, or a finished
/// phrase (one per speaker turn). <c>Start</c> and <c>End</c> are 16 kHz sample positions in the
/// stream fed to the transcriber.
/// </summary>
public sealed record PhraseEvent(string Text, bool IsFinal, SpeakerTag? Speaker, int Phrase, long Start, long End);

/// <summary>
/// Parakeet isn't a streaming model, so this listens like a person reading along:
/// it keeps the audio of the current phrase, re-transcribes it as it grows (a
/// preview) and finalizes it at a pause, or every 15 s of non-stop sound.
/// <para>
/// With a <see cref="VoiceRegistry"/> it also tells speakers apart: a phrase is cut where the
/// pitch jumps or the voice embedding changes, split into turns by the diarizer when it
/// ends, and each turn is matched to a known voice.
/// </para>
/// </summary>
public sealed class PhraseTranscriber : IAsyncDisposable
{
    public const int Rate = 16000;

    private readonly IPhraseRecognizer recognizer;
    private readonly string? language;
    private readonly Action<PhraseEvent> onEvent;
    /// <summary>Recognizes the voices of a phrase; null when speakers aren't told apart.</summary>
    private readonly VoiceRegistry? voices;
    private readonly IVoiceAnalyzer? analyzer;
    private readonly TimeSpan tick;
    private readonly Action<string>? trace;
    private readonly CancellationTokenSource cancel = new();
    private readonly Lock phraseGate = new();
    private readonly Lock identificationGate = new();
    private readonly PhraseState phrase = new();
    private Identification identification = new();
    private readonly Task loop;
    /// <summary>Finished phrases, transcribed and told apart one after another while the next phrase is already being previewed.</summary>
    private Task finals = Task.CompletedTask;
    private int rounds;

    /// <summary>How many times the loop has looked at the phrase; lets tests feed audio in step with it.</summary>
    internal int Rounds => Volatile.Read(ref rounds);

    public PhraseTranscriber(IPhraseRecognizer recognizer, string? language, Action<PhraseEvent> onEvent,
        VoiceRegistry? voices = null, IVoiceAnalyzer? analyzer = null, TimeSpan? tick = null, Action<string>? trace = null)
    {
        this.recognizer = recognizer;
        this.language = language;
        this.onEvent = onEvent;
        this.voices = analyzer is null ? null : voices;
        this.analyzer = analyzer;
        this.tick = tick ?? TimeSpan.FromMilliseconds(150);
        this.trace = trace;
        loop = Task.Run(RunAsync);
    }

    /// <summary>Silence that ends a phrase. Telling speakers apart works per phrase, so it's shorter then.</summary>
    private int Pause => voices is null ? Rate * 8 / 10 : Rate * 6 / 10;

    private sealed record Finished(long Start, float[] Samples, int LeadIn);

    private sealed class PhraseState
    {
        /// <summary>The phrase being spoken.</summary>
        public List<float> Samples { get; } = [];
        /// <summary>Position of Samples[0] in the stream.</summary>
        public long Start { get; set; }
        /// <summary>Index in Samples where speech began.</summary>
        public int? FirstVoice { get; set; }
        /// <summary>Samples of it that sounded like speech.</summary>
        public int Voiced { get; set; }
        /// <summary>Index just after the last speech-like chunk.</summary>
        public int VoiceEnd { get; set; }
        public float NoiseFloor { get; set; } = -60;
        /// <summary>Phrases that ended, waiting for their final transcription. Cut here as the audio arrives, so a busy transcriber can't merge two speakers.</summary>
        public List<Finished> Finished { get; } = [];
        public bool Finishing { get; set; }

        public void FinishPhrase()
        {
            if (Voiced >= Rate / 4)
            {
                // Keep 0.3 s after the last word; trailing silence invites made-up words.
                var end = Math.Min(Samples.Count, VoiceEnd + Rate * 3 / 10);
                Finished.Add(new Finished(Start, [.. Samples.Take(end)], Math.Min(end, Math.Max(0, (FirstVoice ?? 0) - Rate / 10))));
            }
            Start += Samples.Count;
            Samples.Clear();
            Voiced = 0;
            VoiceEnd = 0;
            FirstVoice = null;
        }

        /// <summary>Another voice took over at <paramref name="cut"/>: what came before is a phrase of its own.</summary>
        public void Cut(int cut)
        {
            if (Samples.Count <= cut) return;
            Finished.Add(new Finished(Start, [.. Samples.Take(cut)], Math.Min(cut, Math.Max(0, (FirstVoice ?? 0) - Rate / 10))));
            Samples.RemoveRange(0, cut);
            Start += cut;
            VoiceEnd = Math.Max(0, VoiceEnd - cut);
            Voiced = Math.Max(Rate / 4, Voiced - cut);
            FirstVoice = 0;
        }
    }

    /// <summary>16 kHz mono samples, in order, without gaps (silence included).</summary>
    public void Feed(ReadOnlySpan<float> chunk)
    {
        if (chunk.IsEmpty) return;
        var db = 20 * MathF.Log10(MathF.Max(Speech.Pitch.Rms(chunk), 1e-7f));
        var pause = Pause;
        lock (phraseGate)
        {
            var p = phrase;
            var offset = p.Samples.Count;
            p.Samples.AddRange(chunk);
            p.NoiseFloor = db < p.NoiseFloor ? db : MathF.Min(p.NoiseFloor + 0.05f, db);
            if (db > MathF.Max(p.NoiseFloor + 10, -52))
            {
                p.Voiced += chunk.Length;
                p.VoiceEnd = p.Samples.Count;
                p.FirstVoice ??= offset;
            }
            if (p.Voiced == 0)
            {
                // Nothing said yet: keep only half a second of lead-in.
                if (p.Samples.Count > Rate)
                {
                    var drop = p.Samples.Count - Rate / 2;
                    p.Samples.RemoveRange(0, drop);
                    p.Start += drop;
                }
            }
            else if (p.Samples.Count - p.VoiceEnd > pause || p.Samples.Count > Rate * 15)
            {
                p.FinishPhrase();
            }
        }
    }

    /// <summary>Ends the input and waits for the last phrases to be transcribed.</summary>
    public async Task FinishAsync()
    {
        lock (phraseGate) phrase.Finishing = true;
        await loop;
        Task pending;
        lock (identificationGate) pending = finals;
        await pending;
    }

    public async ValueTask DisposeAsync()
    {
        await cancel.CancelAsync();
        try
        {
            await loop;
        }
        catch (OperationCanceledException)
        {
        }
        cancel.Dispose();
    }

    // ---- Live loop

    /// <summary>Who speaks in the phrase being previewed, worked out next to the transcription so it never holds the text up.</summary>
    private sealed record Identification
    {
        /// <summary>Counts phrases, so a late answer about an earlier phrase is ignored.</summary>
        public int Phrase { get; init; }
        /// <summary>Where the person speaking now started in the phrase, and who it is.</summary>
        public (int Start, SpeakerTag Tag)? Turn { get; init; }
        public int CheckedAt { get; init; }
        public bool Running { get; init; }
        /// <summary>The latest preview, sent again when it turns out to be someone else's.</summary>
        public PhraseEvent? Shown { get; init; }
        /// <summary>The voice the phrase started with, to notice when someone else takes over.</summary>
        public float[]? Reference { get; init; }
        public int WatchedTo { get; init; }
        public bool Watching { get; init; }
        /// <summary>Where the voice first seemed to change, waiting for a second look.</summary>
        public int? Suspect { get; init; }
        /// <summary>Where another voice took over; the phrase is cut there.</summary>
        public int? Cut { get; init; }
    }

    /// <summary>Pitch of each 0.4 s of the current phrase (null where nobody speaks).</summary>
    internal sealed class PitchTrack
    {
        public const int Window = Rate * 4 / 10;
        public List<float?> Pitches { get; } = [];
        public int TurnStart { get; set; }

        public int Analyzed => Pitches.Count * Window;

        public void Extend(float[] phrase)
        {
            while (Analyzed + Window <= phrase.Length) Pitches.Add(Speech.Pitch.Median(phrase.AsSpan(Analyzed, Window)));
        }

        /// <summary>Pitch of the words said lately; null before 1.2 s of speech.</summary>
        public float? Recent
        {
            get
            {
                var voiced = Pitches.Skip(TurnStart).TakeLast(4).OfType<float>().ToList();
                return voiced.Count >= 3 ? MedianOf(voiced) : null;
            }
        }

        /// <summary>
        /// Where another voice took over, judged by pitch alone: the last 0.8 s of speech sits
        /// more than 6 semitones away from the 1.2 s or more before it. Intonation moves a voice
        /// about 3–4 semitones; a man and a woman are about 10 apart.
        /// </summary>
        public int? Change()
        {
            var voiced = Enumerable.Range(0, Pitches.Count).Where(i => i >= TurnStart && Pitches[i] is not null).ToList();
            if (voiced.Count < 5) return null;
            var recent = voiced.TakeLast(2).ToList();
            if (MedianOf([.. voiced.SkipLast(2).Select(i => Pitches[i]!.Value)]) is not { } baseline) return null;
            var jumps = recent.Select(i => MathF.Abs(12 * MathF.Log2(Pitches[i]!.Value / baseline))).ToList();
            return jumps.All(j => j > 6) ? recent[0] * Window : null;
        }

        private static float? MedianOf(List<float> values)
        {
            if (values.Count == 0) return null;
            values.Sort();
            return values[values.Count / 2];
        }
    }

    private async Task RunAsync()
    {
        var token = cancel.Token;
        var previewedUpTo = 0;
        var track = new PitchTrack();
        while (!token.IsCancellationRequested)
        {
            await Task.Delay(tick, token);
            Interlocked.Increment(ref rounds);
            List<Finished> finished;
            float[] current;
            bool finishing;
            long start;
            int? firstVoice;
            int voiced;
            lock (phraseGate)
            {
                if (phrase.Finishing) phrase.FinishPhrase();
                finished = [.. phrase.Finished];
                phrase.Finished.Clear();
                current = [.. phrase.Samples];
                finishing = phrase.Finishing;
                start = phrase.Start;
                firstVoice = phrase.FirstVoice;
                voiced = phrase.Voiced;
            }
            foreach (var piece in finished)
            {
                int number;
                lock (identificationGate)
                {
                    number = identification.Phrase;
                    identification = new Identification { Phrase = number + 1 };
                }
                if (voices is null)
                {
                    await FinishAsync(piece, number, token);
                }
                else
                {
                    // Telling speakers apart takes a moment; don't hold up the next phrase's words for it.
                    lock (identificationGate)
                    {
                        var previous = finals;
                        finals = Task.Run(async () =>
                        {
                            await previous;
                            await FinishAsync(piece, number, token);
                        }, CancellationToken.None);
                    }
                }
                if (token.IsCancellationRequested) return;
                previewedUpTo = 0;
                track = new PitchTrack();
            }
            if (finishing) return;

            // Preview the phrase in progress as soon as the recognizer can.
            if (previewedUpTo > current.Length)
            {
                previewedUpTo = 0;
                lock (identificationGate) identification = new Identification { Phrase = identification.Phrase + 1 };
            }
            if (voices is not null)
            {
                if (voiced == 0 || track.Analyzed > current.Length) track = new PitchTrack();
                track.Extend(current);
                // The pitch jumped: someone else speaks. Their words start a phrase of their own right away; who it is gets sorted out after.
                if (track.Change() is { } pitchCut)
                {
                    lock (phraseGate) phrase.Cut(pitchCut);
                    trace?.Invoke($"cut by pitch at {(start + pitchCut) / (double)Rate:0.0} s");
                    continue;
                }
                // The same for a change the voice embedding noticed (two people of about the same pitch).
                int? voiceCut;
                lock (identificationGate)
                {
                    voiceCut = identification.Cut;
                    identification = identification with { Cut = null };
                }
                if (voiceCut is { } cut && cut < current.Length)
                {
                    lock (phraseGate) phrase.Cut(cut);
                    trace?.Invoke($"cut by voice at {(start + cut) / (double)Rate:0.0} s");
                    continue;
                }
                WatchForAnotherVoice(current, token);
            }
            if (voiced < Rate / 4 || current.Length < recognizer.MinimumPreview || current.Length - previewedUpTo < Rate * 4 / 10) continue;

            IdentifyInBackground(current, token);
            var audio = current;
            SpeakerTag? tag = null;
            var from = firstVoice ?? 0;
            Identification state;
            lock (identificationGate) state = identification;
            if (voices is not null)
            {
                // Until the voice is known the words go to whoever is most likely talking, and move once it is.
                tag = (state.Turn?.Tag ?? SpeakerTag.Unknown) with { Phrase = state.Phrase, Pitch = track.Recent };
                // Only the words of whoever is speaking now.
                if (state.Turn is { } turn)
                {
                    audio = current[Math.Min(turn.Start, current.Length)..];
                    from = turn.Start;
                }
            }
            var text = await TranscribeAsync(audio, token);
            if (token.IsCancellationRequested) return;
            previewedUpTo = current.Length;
            // The phrase may have ended meanwhile; its final text is on the way.
            bool stillCurrent;
            lock (phraseGate) stillCurrent = phrase.Finished.Count == 0 && phrase.Samples.Count >= current.Length && phrase.Start == start;
            if (stillCurrent && text.Length > 0)
            {
                var preview = new PhraseEvent(text, false, tag, state.Phrase, start + from, start + current.Length);
                lock (identificationGate)
                {
                    if (identification.Phrase == state.Phrase) identification = identification with { Shown = preview };
                }
                onEvent(preview);
            }
        }
    }

    /// <summary>
    /// Finds who is speaking now, first after a second of the phrase and then every two
    /// seconds, without waiting for it; re-sends the preview if it turns out to be someone else's.
    /// </summary>
    private void IdentifyInBackground(float[] current, CancellationToken token)
    {
        if (voices is null || analyzer is null) return;
        int number;
        lock (identificationGate)
        {
            var state = identification;
            if (state.Running || current.Length < Rate || (state.Turn is not null && current.Length - state.CheckedAt < Rate * 2)) return;
            identification = state with { Running = true, CheckedAt = current.Length };
            number = state.Phrase;
        }
        _ = Task.Run(async () =>
        {
            (int Start, SpeakerTag Tag)? found = null;
            try
            {
                var turns = await analyzer.TurnsAsync(current, token);
                if (turns.Count > 0)
                {
                    var last = turns[^1];
                    var sample = await SampleAsync(current.AsMemory(last.Start, last.Length), token);
                    found = (last.Start, sample is null ? SpeakerTag.Unknown : voices.Match(sample));
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            PhraseEvent? resend = null;
            lock (identificationGate)
            {
                if (identification.Phrase != number) return;
                identification = identification with { Running = false };
                if (found is not { } turn) return;
                identification = identification with { Turn = turn };
                if (identification.Shown is not { } shown) return;
                // Known now, or plainly someone new: move the words there.
                var moved = turn.Tag.Voice is not null
                    ? shown.Speaker?.Voice != turn.Tag.Voice
                    : turn.Tag.Unfamiliar && !(shown.Speaker?.Unfamiliar ?? false);
                if (!moved) return;
                resend = shown with { Speaker = turn.Tag with { Phrase = number } };
                identification = identification with { Shown = resend };
            }
            onEvent(resend);
        }, CancellationToken.None);
    }

    /// <summary>
    /// Compares the last 1.5 s of the phrase with how it began, every half second, and marks
    /// where another voice took over: one clear difference, or two likely ones in a row.
    /// </summary>
    private void WatchForAnotherVoice(float[] current, CancellationToken token)
    {
        if (analyzer is null) return;
        const int window = Rate * 3 / 2;
        int number;
        float[]? reference;
        lock (identificationGate)
        {
            var state = identification;
            if (state.Watching) return;
            if (state.Reference is null)
            {
                if (current.Length < Rate * 5 / 2) return;
                reference = null;
            }
            else
            {
                if (current.Length - state.WatchedTo < Rate / 2 || current.Length < Rate * 4) return;
                reference = state.Reference;
            }
            identification = state with { Watching = true, WatchedTo = reference is null ? state.WatchedTo : current.Length };
            number = state.Phrase;
        }
        _ = Task.Run(async () =>
        {
            try
            {
                if (reference is null)
                {
                    // The first two seconds of speech (after the lead-in).
                    var embedding = await analyzer.EmbeddingAsync(current.AsMemory(Rate / 2, Rate * 2), token);
                    lock (identificationGate)
                    {
                        if (identification.Phrase != number) return;
                        identification = identification with { Watching = false, Reference = embedding, WatchedTo = current.Length };
                    }
                    return;
                }
                var from = current.Length - window;
                var latest = await analyzer.EmbeddingAsync(current.AsMemory(from), token);
                var distance = latest is null ? 0 : VoiceRegistry.Distance(reference, latest);
                lock (identificationGate)
                {
                    if (identification.Phrase != number) return;
                    // The change is most likely in the middle of the window.
                    var here = from + window / 3;
                    // One person against the start of their own phrase: 0.51 typical, 0.69 at the
                    // 90th percentile; a change of speaker: 0.85–0.95.
                    identification = distance > 0.82f || (distance > 0.72f && identification.Suspect is not null)
                        ? identification with { Watching = false, Cut = identification.Suspect ?? here }
                        : identification with { Watching = false, Suspect = distance > 0.72f ? here : null };
                }
                trace?.Invoke($"watch {distance:0.000} at {current.Length / (double)Rate:0.0} s of the phrase");
            }
            catch (OperationCanceledException)
            {
            }
        }, CancellationToken.None);
    }

    // ---- Finished phrases

    /// <summary>A finished phrase: split at speaker changes, each turn to its speaker.</summary>
    private async Task FinishAsync(Finished piece, int number, CancellationToken token)
    {
        try
        {
            if (voices is null || analyzer is null)
            {
                var text = await TranscribeAsync(piece.Samples, token);
                onEvent(new PhraseEvent(text, true, null, number, piece.Start + piece.LeadIn, piece.Start + piece.Samples.Length));
                return;
            }
            var turns = await analyzer.TurnsAsync(piece.Samples, token);
            for (var index = 0; index < turns.Count; index++)
            {
                var turn = turns[index];
                var part = piece.Samples[turn.Start..turn.End];
                var text = await TranscribeAsync(part, token);
                // An unrecognized voice becomes a new speaker rather than a guess.
                var sample = await SampleAsync(part, token);
                var tag = (sample is null ? SpeakerTag.Unknown : voices.Identify(sample)) with { Phrase = number };
                var lower = index == 0 ? Math.Min(Math.Max(turn.Start, piece.LeadIn), turn.End) : turn.Start;
                trace?.Invoke($"final {(piece.Start + lower) / (double)Rate:0.0}–{(piece.Start + turn.End) / (double)Rate:0.0} s voice {tag.Voice?.ToString() ?? "?"}: {text}");
                onEvent(new PhraseEvent(text, true, tag, number, piece.Start + lower, piece.Start + turn.End));
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    /// <summary>Who is speaking in a stretch of audio and how their voice sounds.</summary>
    private async Task<VoiceSample?> SampleAsync(ReadOnlyMemory<float> audio, CancellationToken token)
    {
        if (analyzer is null) return null;
        var embedding = await analyzer.EmbeddingAsync(audio, token);
        return embedding is null ? null : new VoiceSample(embedding, VoiceTraits.Measure(audio.Span));
    }

    private async Task<string> TranscribeAsync(float[] audio, CancellationToken token)
    {
        try
        {
            return await recognizer.TranscribeAsync(audio, language, token);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception error)
        {
            trace?.Invoke($"transcription failed: {error.Message}");
            return "";
        }
    }
}
