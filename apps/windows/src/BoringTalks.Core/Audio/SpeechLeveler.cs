namespace BoringTalks.Core.Audio;

/// <summary>
/// Brings one side's speech to a steady level before it is mixed, so a quiet headset microphone
/// sounds as loud as the call. Works on 10 ms blocks of 16 kHz audio: the level of speech (blocks
/// above the noise floor) is followed slowly, the gain moves gently towards target ÷ level, and
/// during silence the gain stays where it was, so pauses aren't pumped up into hiss.
/// </summary>
public sealed class SpeechLeveler(float target = 0.1f, float maxGain = 4f, float minGain = 0.5f)
{
    public const int Block = 160;

    /// <summary>About −50 dBFS: quieter blocks are silence or room noise and leave the gain alone.</summary>
    public const float NoiseFloor = 0.003f;

    private float level;
    private readonly List<float> carry = [];

    public float Gain { get; private set; } = 1f;

    /// <summary>The samples, levelled. Whole blocks go through at once; a remainder waits for the next call.</summary>
    public float[] Process(ReadOnlySpan<float> samples)
    {
        carry.AddRange(samples);
        var whole = carry.Count - carry.Count % Block;
        var output = new float[whole];
        for (var start = 0; start < whole; start += Block)
        {
            double sum = 0;
            for (var i = start; i < start + Block; i++) sum += carry[i] * carry[i];
            var rms = (float)Math.Sqrt(sum / Block);
            var from = Gain;
            if (rms > NoiseFloor)
            {
                // ~2 s to settle on a new voice level, ~0.5 s for the gain to follow.
                level = level == 0 ? rms : level + (rms - level) * 0.05f;
                var wanted = Math.Clamp(target / level, minGain, maxGain);
                Gain += (wanted - Gain) * 0.2f;
            }
            // Ramp across the block, so a gain change never clicks.
            for (var i = 0; i < Block; i++)
            {
                var g = from + (Gain - from) * (i + 1) / Block;
                output[start + i] = carry[start + i] * g;
            }
        }
        carry.RemoveRange(0, whole);
        return output;
    }

    /// <summary>What's left at the end of the meeting, at the current gain.</summary>
    public float[] Flush()
    {
        var rest = carry.Select(s => s * Gain).ToArray();
        carry.Clear();
        return rest;
    }
}
