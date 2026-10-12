namespace BoringTalks.Core.Speech;

/// <summary>Pitch of 16 kHz speech, found with the YIN method.</summary>
public static class Pitch
{
    internal const int MinLag = 40;  // 400 Hz
    internal const int MaxLag = 228; // 70 Hz
    private const float Rate = 16000;

    /// <summary>Median fundamental frequency (Hz) of the voiced parts; null when too little of it is voiced.</summary>
    public static float? Median(ReadOnlySpan<float> x)
    {
        const int frame = 800, hop = 480;
        if (x.Length < frame + MaxLag) return null;
        var gate = MathF.Max(Rms(x) * 0.5f, 1e-3f);
        Span<float> normalized = stackalloc float[MaxLag + 1];
        var pitches = new List<float>();
        for (var start = 0; start + frame + MaxLag <= x.Length && pitches.Count < 200; start += hop)
        {
            if (Rms(x.Slice(start, frame)) <= gate) continue;
            if (Yin(x, start, frame, normalized, 0.15f) is { } lag) pitches.Add(Rate / lag);
        }
        if (pitches.Count < 5) return null;
        pitches.Sort();
        return pitches[pitches.Count / 2];
    }

    /// <summary>
    /// The YIN lag of the frame at <paramref name="start"/>: the first dip of the cumulative-mean
    /// normalized difference below <paramref name="threshold"/>, followed to its minimum.
    /// Fills <paramref name="normalized"/> (for the frame's aperiodicity).
    /// </summary>
    internal static int? Yin(ReadOnlySpan<float> x, int start, int frame, Span<float> normalized, float threshold)
    {
        float running = 0;
        normalized[0] = 1;
        for (var lag = 1; lag <= MaxLag; lag++)
        {
            float difference = 0;
            for (var i = 0; i < frame; i++)
            {
                var d = x[start + i] - x[start + i + lag];
                difference += d * d;
            }
            running += difference;
            normalized[lag] = difference * lag / MathF.Max(running, 1e-9f);
        }
        for (var lag = MinLag; lag <= MaxLag; lag++)
        {
            if (normalized[lag] >= threshold) continue;
            while (lag < MaxLag && normalized[lag + 1] < normalized[lag]) lag++;
            return lag;
        }
        return null;
    }

    internal static float Rms(ReadOnlySpan<float> x)
    {
        if (x.IsEmpty) return 0;
        double sum = 0;
        foreach (var v in x) sum += v * v;
        return (float)Math.Sqrt(sum / x.Length);
    }
}
