namespace BoringTalks.Core.Audio;

/// <summary>
/// The two short tones played when a recording starts (rising) and stops (falling), made in memory
/// as a 16-bit mono WAV: no audio files to ship. A soft attack and an exponential decay, so they
/// click neither in nor out; quiet (a quarter of full scale). The Mac app makes the same ones.
/// </summary>
public static class Chime
{
    public const int SampleRate = 44100;
    public const double ToneSeconds = 0.09;
    public const float Peak = 0.25f;

    /// <summary>E5 then A5 to start; the other way round to stop.</summary>
    public static byte[] Wav(bool rising) => ToWav(Samples(rising ? [659.25, 880.0] : [880.0, 659.25]));

    /// <summary>How long a chime plays, to wait it out before the microphone opens.</summary>
    public static TimeSpan Duration => TimeSpan.FromSeconds(ToneSeconds * 2);

    public static float[] Samples(IReadOnlyList<double> frequencies)
    {
        var perTone = (int)(SampleRate * ToneSeconds);
        var samples = new float[perTone * frequencies.Count];
        var attack = (int)(SampleRate * 0.005);
        for (var t = 0; t < frequencies.Count; t++)
        {
            for (var i = 0; i < perTone; i++)
            {
                var envelope = Math.Min(1.0, i / (double)attack) * Math.Exp(-5.0 * i / perTone);
                samples[t * perTone + i] = (float)(Peak * envelope * Math.Sin(2 * Math.PI * frequencies[t] * i / SampleRate));
            }
        }
        return samples;
    }

    public static byte[] ToWav(float[] samples)
    {
        using var stream = new MemoryStream();
        using (var writer = new BinaryWriter(stream, System.Text.Encoding.ASCII, leaveOpen: true))
        {
            var dataBytes = samples.Length * 2;
            writer.Write("RIFF"u8);
            writer.Write(36 + dataBytes);
            writer.Write("WAVE"u8);
            writer.Write("fmt "u8);
            writer.Write(16);
            writer.Write((short)1);
            writer.Write((short)1);
            writer.Write(SampleRate);
            writer.Write(SampleRate * 2);
            writer.Write((short)2);
            writer.Write((short)16);
            writer.Write("data"u8);
            writer.Write(dataBytes);
            foreach (var s in samples) writer.Write((short)Math.Clamp(s * 32767f, short.MinValue, short.MaxValue));
        }
        return stream.ToArray();
    }
}
