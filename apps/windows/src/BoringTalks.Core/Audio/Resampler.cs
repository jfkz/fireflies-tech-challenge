namespace BoringTalks.Core.Audio;

/// <summary>
/// Streaming sample-rate converter for one mono channel: windowed-sinc interpolation
/// with a low-pass at the lower of the two Nyquist frequencies, so 48 kHz call audio
/// comes down to the 16 kHz the speech model takes without aliasing, and the 16 kHz
/// mix goes up to the 48 kHz the AAC encoder takes. Keeps its history between calls,
/// so chunks of any size join without clicks.
/// </summary>
public sealed class Resampler
{
    /// <summary>Zero crossings of the sinc on each side, at the lower rate.</summary>
    private const int Lobes = 16;
    private readonly int halfWidth;
    private readonly double step;
    private readonly double cutoff;
    private readonly List<float> history = [];
    /// <summary>Position of the next output sample, in input samples relative to history[0].</summary>
    private double position;

    public Resampler(int inputRate, int outputRate)
    {
        if (inputRate <= 0 || outputRate <= 0) throw new ArgumentOutOfRangeException(nameof(inputRate), "Sample rates must be positive.");
        InputRate = inputRate;
        OutputRate = outputRate;
        step = (double)inputRate / outputRate;
        cutoff = Math.Min(1.0, (double)outputRate / inputRate) * 0.95;
        halfWidth = (int)Math.Ceiling(Lobes / cutoff);
        // Start "in the past" so the first output sample lines up with the first input sample.
        history.AddRange(new float[halfWidth]);
        position = halfWidth;
    }

    public int InputRate { get; }
    public int OutputRate { get; }

    public float[] Process(ReadOnlySpan<float> input)
    {
        if (InputRate == OutputRate) return input.ToArray();
        history.AddRange(input);
        var output = new List<float>((int)(input.Length / step) + 2);
        while (position + halfWidth < history.Count)
        {
            output.Add(Interpolate(position));
            position += step;
        }
        // Keep only what the next call still needs.
        var drop = Math.Max(0, (int)Math.Floor(position) - halfWidth);
        if (drop > 0)
        {
            history.RemoveRange(0, drop);
            position -= drop;
        }
        return [.. output];
    }

    private float Interpolate(double at)
    {
        var center = (int)Math.Floor(at);
        var frac = at - center;
        double sum = 0, weights = 0;
        for (var k = -halfWidth + 1; k <= halfWidth; k++)
        {
            var index = center + k;
            if (index < 0 || index >= history.Count) continue;
            var x = k - frac;
            var w = Sinc(x * cutoff) * Window(x / halfWidth);
            sum += history[index] * w;
            weights += w;
        }
        return weights == 0 ? 0 : (float)(sum / weights);
    }

    private static double Sinc(double x) => Math.Abs(x) < 1e-9 ? 1 : Math.Sin(Math.PI * x) / (Math.PI * x);

    /// <summary>Blackman window over [-1, 1].</summary>
    private static double Window(double x) =>
        Math.Abs(x) >= 1 ? 0 : 0.42 + 0.5 * Math.Cos(Math.PI * x) + 0.08 * Math.Cos(2 * Math.PI * x);

    /// <summary>Averages interleaved channels into mono.</summary>
    public static float[] Downmix(ReadOnlySpan<float> interleaved, int channels)
    {
        if (channels <= 1) return interleaved.ToArray();
        var frames = interleaved.Length / channels;
        var mono = new float[frames];
        for (var f = 0; f < frames; f++)
        {
            float sum = 0;
            for (var c = 0; c < channels; c++) sum += interleaved[f * channels + c];
            mono[f] = sum / channels;
        }
        return mono;
    }
}
