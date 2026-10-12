using BoringTalks.Core.Transcript;

namespace BoringTalks.Core.Audio;

/// <summary>
/// Keeps one channel's samples on the meeting clock.
/// <para>
/// Both channels count 16 kHz samples from the meeting start, so a sample index
/// is a time. A capture that starts late, drops out (a device change, a sleeping
/// Bluetooth headset) or stalls (loopback delivers nothing while nothing plays) would
/// put that channel behind the other; the gap is filled with silence so both stay
/// within half a second of the shared clock.
/// </para>
/// </summary>
public sealed class ChannelTimeline(double sampleRate = 16000, double toleranceSeconds = 0.5)
{
    public double SampleRate { get; } = sampleRate;

    /// <summary>Samples written so far, silence included.</summary>
    public long Written { get; private set; }

    /// <summary>
    /// <paramref name="frames"/> samples arrived, ending <paramref name="elapsed"/> seconds after the
    /// meeting start. Returns how many samples of silence go in front of them.
    /// </summary>
    public int SilenceBefore(int frames, double elapsed)
    {
        var expectedEnd = (long)Math.Round(elapsed * SampleRate);
        var gap = expectedEnd - (Written + frames);
        var silence = gap > (long)(toleranceSeconds * SampleRate) ? (int)gap : 0;
        Written += silence + frames;
        return silence;
    }

    /// <summary>
    /// Nothing arrived for a while: the silence that brings the channel up to
    /// <paramref name="elapsed"/>, or 0 while it is within <paramref name="lag"/> seconds of it.
    /// </summary>
    public int CatchUp(double elapsed, double lag = 1.5)
    {
        var behind = (long)Math.Round(elapsed * SampleRate) - Written;
        if (behind <= (long)(lag * SampleRate)) return 0;
        Written += behind;
        return (int)behind;
    }

    /// <summary>Sample position → milliseconds from the meeting start.</summary>
    public int Milliseconds(long sample) => (int)Math.Round(sample * 1000 / SampleRate);
}

/// <summary>
/// Mixes the two channels into the mono track that is saved and uploaded.
/// Both arrive on the same clock (see <see cref="ChannelTimeline"/>), so sample <i>n</i> of one
/// plays with sample <i>n</i> of the other; whatever one channel has that the other
/// hasn't delivered yet waits here.
/// </summary>
public sealed class AudioMixer
{
    private readonly Dictionary<AudioChannel, List<float>> pending = [];
    private readonly HashSet<AudioChannel> active;

    public AudioMixer(IEnumerable<AudioChannel>? channels = null)
    {
        active = [.. channels ?? Enum.GetValues<AudioChannel>()];
    }

    /// <summary>Gain per channel; the call is usually quieter than the user's own microphone.</summary>
    public Dictionary<AudioChannel, float> Gains { get; } = new() { [AudioChannel.Microphone] = 0.8f, [AudioChannel.System] = 1.0f };

    public void Append(ReadOnlySpan<float> samples, AudioChannel channel)
    {
        if (!active.Contains(channel)) return;
        if (!pending.TryGetValue(channel, out var list)) pending[channel] = list = [];
        list.AddRange(samples);
    }

    /// <summary>A channel that stopped for good (its capture failed): mix without it.</summary>
    public void Remove(AudioChannel channel)
    {
        active.Remove(channel);
        pending.Remove(channel);
    }

    /// <summary>
    /// Mixed samples ready to write: as far as every active channel has got, or
    /// everything with <paramref name="flush"/> (the end of the meeting).
    /// </summary>
    public float[] Drain(bool flush = false)
    {
        if (active.Count == 0) return [];
        var lengths = active.Select(c => pending.TryGetValue(c, out var l) ? l.Count : 0).ToList();
        var count = flush ? lengths.Max() : lengths.Min();
        if (count <= 0) return [];
        var mixed = new float[count];
        foreach (var channel in active)
        {
            if (!pending.TryGetValue(channel, out var samples)) continue;
            var gain = Gains.GetValueOrDefault(channel, 1f);
            var available = Math.Min(count, samples.Count);
            for (var i = 0; i < available; i++) mixed[i] += samples[i] * gain;
            samples.RemoveRange(0, available);
        }
        // Soft limit instead of hard clipping when both sides talk at once.
        for (var i = 0; i < mixed.Length; i++)
        {
            var v = mixed[i];
            if (MathF.Abs(v) > 0.9f) mixed[i] = v > 0 ? 0.9f + 0.1f * MathF.Tanh((v - 0.9f) * 10) : -0.9f - 0.1f * MathF.Tanh((-v - 0.9f) * 10);
        }
        return mixed;
    }
}
