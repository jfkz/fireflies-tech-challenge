using System.Numerics;

namespace BoringTalks.Core.Speech;

/// <summary>
/// Measurable characteristics of a voice in a stretch of 16 kHz audio, used next to
/// the neural embedding to tell voices apart: how high it is, how much it moves
/// (flat or lively intonation), its timbre (the shape of the spectrum, as cepstral
/// coefficients), how bright it sounds and how breathy or rough it is.
/// </summary>
public sealed record VoiceTraits
{
    public const int Coefficients = 12;

    /// <summary>Median fundamental frequency, Hz.</summary>
    public float? Pitch { get; init; }
    /// <summary>Spread of the pitch: interquartile range in semitones.</summary>
    public float? PitchRange { get; init; }
    /// <summary>Mean of the cepstral coefficients c1…c12 over voiced frames: the timbre.</summary>
    public float[] Timbre { get; init; } = new float[Coefficients];
    /// <summary>Mean spectral centroid of voiced frames, Hz.</summary>
    public float Brightness { get; init; }
    /// <summary>Mean YIN aperiodicity of voiced frames: low for a clear voice, higher for a breathy or rough one.</summary>
    public float Breathiness { get; init; }
    /// <summary>Voiced frames the traits come from.</summary>
    public int VoicedFrames { get; init; }

    /// <summary>Null when there is too little voiced speech to measure.</summary>
    public static VoiceTraits? Measure(ReadOnlySpan<float> samples) => Analyzer.Measure(samples);

    /// <summary>Per-trait gaps between two voices, in units that suit each trait.</summary>
    public float[] Gaps(VoiceTraits other)
    {
        var pitchGap = Pitch is { } a && other.Pitch is { } b ? MathF.Abs(12 * MathF.Log2(a / b)) : 0;
        var rangeGap = PitchRange is { } c && other.PitchRange is { } d ? MathF.Abs(c - d) : 0;
        float timbreGap = 0;
        for (var i = 0; i < Math.Min(Timbre.Length, other.Timbre.Length); i++) timbreGap += (Timbre[i] - other.Timbre[i]) * (Timbre[i] - other.Timbre[i]);
        return
        [
            pitchGap,
            rangeGap,
            MathF.Sqrt(timbreGap),
            MathF.Abs(12 * MathF.Log2(MathF.Max(Brightness, 1) / MathF.Max(other.Brightness, 1))),
            MathF.Abs(Breathiness - other.Breathiness),
        ];
    }

    /// <summary>Running average with another measurement of the same voice.</summary>
    public VoiceTraits Merge(VoiceTraits other)
    {
        var total = (float)(VoicedFrames + other.VoicedFrames);
        if (total <= 0) return this;
        float a = VoicedFrames / total, b = other.VoicedFrames / total;
        float? Mix(float? x, float? y) => x is { } p && y is { } q ? p * a + q * b : x ?? y;
        return this with
        {
            Pitch = Pitch is { } p && other.Pitch is { } q ? MathF.Pow(2, MathF.Log2(p) * a + MathF.Log2(q) * b) : Pitch ?? other.Pitch,
            PitchRange = Mix(PitchRange, other.PitchRange),
            Timbre = [.. Timbre.Zip(other.Timbre, (x, y) => x * a + y * b)],
            Brightness = Brightness * a + other.Brightness * b,
            Breathiness = Breathiness * a + other.Breathiness * b,
            VoicedFrames = VoicedFrames + other.VoicedFrames,
        };
    }

    /// <summary>FFT set-up shared by all measurements.</summary>
    private static class Analyzer
    {
        private const float Rate = 16000;
        private const int FftSize = 512;
        private const int Hop = 320;
        private const int YinFrame = 640;
        private const int Bands = 26;
        private static readonly float[] Window = [.. Enumerable.Range(0, FftSize).Select(n => 0.5f - 0.5f * MathF.Cos(2 * MathF.PI * n / FftSize))];
        private static readonly float[][] Filters = MelFilters();
        private static readonly float[][] Dct =
            [.. Enumerable.Range(1, Coefficients).Select(k => Enumerable.Range(0, Bands).Select(n => MathF.Cos(MathF.PI * k * (n + 0.5f) / Bands)).ToArray())];

        /// <summary>Triangular mel filters from 60 Hz to 7.6 kHz.</summary>
        private static float[][] MelFilters()
        {
            static float Mel(float hz) => 2595 * MathF.Log10(1 + hz / 700);
            static float Hz(float mel) => 700 * (MathF.Pow(10, mel / 2595) - 1);
            float low = Mel(60), high = Mel(7600);
            var edges = Enumerable.Range(0, Bands + 2).Select(i => Hz(low + (high - low) * i / (Bands + 1))).ToArray();
            const int bins = FftSize / 2;
            return [.. Enumerable.Range(0, Bands).Select(band => Enumerable.Range(0, bins).Select(bin =>
            {
                var f = bin * Rate / FftSize;
                float a = edges[band], b = edges[band + 1], c = edges[band + 2];
                if (f <= a || f >= c) return 0f;
                return f < b ? (f - a) / (b - a) : (c - f) / (c - b);
            }).ToArray())];
        }

        public static VoiceTraits? Measure(ReadOnlySpan<float> x)
        {
            if (x.Length < YinFrame + Speech.Pitch.MaxLag) return null;
            var gate = MathF.Max(Speech.Pitch.Rms(x) * 0.5f, 1e-3f);
            var pitches = new List<float>();
            float aperiodicity = 0, brightness = 0;
            var timbre = new float[Coefficients];
            var voiced = 0;
            Span<float> normalized = stackalloc float[Speech.Pitch.MaxLag + 1];
            var spectrum = new Complex[FftSize];
            var power = new float[FftSize / 2];
            var logBands = new float[Bands];

            for (var start = 0; start + Math.Max(YinFrame + Speech.Pitch.MaxLag, FftSize) <= x.Length; start += Hop)
            {
                if (Speech.Pitch.Rms(x.Slice(start, YinFrame)) <= gate) continue;
                // YIN: pitch, and how periodic the frame is.
                if (Speech.Pitch.Yin(x, start, YinFrame, normalized, 0.2f) is not { } lag) continue;
                pitches.Add(Rate / lag);
                aperiodicity += normalized[lag];

                // Spectrum: mel cepstrum and centroid.
                for (var i = 0; i < FftSize; i++) spectrum[i] = new Complex(x[start + i] * Window[i], 0);
                Fft.Transform(spectrum);
                double total = 0, weighted = 0;
                for (var bin = 0; bin < power.Length; bin++)
                {
                    power[bin] = (float)(spectrum[bin].Real * spectrum[bin].Real + spectrum[bin].Imaginary * spectrum[bin].Imaginary);
                    total += power[bin];
                    weighted += power[bin] * (bin * Rate / FftSize);
                }
                brightness += (float)(weighted / Math.Max(total, 1e-12));
                for (var band = 0; band < Bands; band++)
                {
                    float energy = 0;
                    for (var bin = 0; bin < power.Length; bin++) energy += Filters[band][bin] * power[bin];
                    logBands[band] = MathF.Log(MathF.Max(energy, 1e-10f));
                }
                for (var k = 0; k < Coefficients; k++)
                {
                    float sum = 0;
                    for (var band = 0; band < Bands; band++) sum += Dct[k][band] * logBands[band];
                    timbre[k] += sum;
                }
                voiced++;
            }
            if (voiced < 8) return null;
            pitches.Sort();
            float Quartile(float q) => pitches[Math.Min(pitches.Count - 1, (int)((pitches.Count - 1) * q))];
            float n = voiced;
            return new VoiceTraits
            {
                Pitch = Quartile(0.5f),
                PitchRange = 12 * MathF.Log2(Quartile(0.75f) / Quartile(0.25f)),
                Timbre = [.. timbre.Select(t => t / n)],
                Brightness = brightness / n,
                Breathiness = aperiodicity / n,
                VoicedFrames = voiced,
            };
        }
    }
}

/// <summary>In-place iterative radix-2 FFT.</summary>
internal static class Fft
{
    public static void Transform(Complex[] data)
    {
        var n = data.Length;
        if (n == 0 || (n & (n - 1)) != 0) throw new ArgumentException("Length must be a power of two.", nameof(data));
        for (int i = 1, j = 0; i < n; i++)
        {
            var bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) (data[i], data[j]) = (data[j], data[i]);
        }
        for (var length = 2; length <= n; length <<= 1)
        {
            var angle = -2 * Math.PI / length;
            var step = new Complex(Math.Cos(angle), Math.Sin(angle));
            for (var i = 0; i < n; i += length)
            {
                var w = Complex.One;
                for (var k = 0; k < length / 2; k++)
                {
                    var even = data[i + k];
                    var odd = data[i + k + length / 2] * w;
                    data[i + k] = even + odd;
                    data[i + k + length / 2] = even - odd;
                    w *= step;
                }
            }
        }
    }
}
