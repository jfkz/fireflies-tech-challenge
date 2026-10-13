namespace BoringTalks.Core.Audio;

/// <summary>
/// Loudness of one channel, written from the audio thread and read by the level bars
/// and the avatar renderer every frame.
/// </summary>
public sealed class LevelMeter(TimeProvider? time = null)
{
    public readonly record struct Snapshot(float Level, float Syllable, double SinceSound);

    private readonly TimeProvider time = time ?? TimeProvider.System;
    private readonly Lock gate = new();
    private float level;
    private float peak = -50;
    private float valley = float.NaN;
    private float syllable;
    private float noiseFloor = -70;
    private long lastSound = long.MinValue;

    /// <summary>A chunk of mono samples lasting <paramref name="seconds"/>.</summary>
    public void Push(ReadOnlySpan<float> samples, float seconds)
    {
        if (samples.IsEmpty) return;
        double sum = 0;
        foreach (var v in samples) sum += v * v;
        var rms = (float)Math.Sqrt(sum / samples.Length);
        var db = 20 * MathF.Log10(MathF.Max(rms, 1e-7f));
        lock (gate)
        {
            // Automatic gain: the recent peak (falling 4 dB/s) maps to 1, 30 dB below it to 0.
            peak = MathF.Max(MathF.Max(db, peak - 4 * seconds), -50);
            var now = db < -65 ? 0 : Math.Clamp((db - peak + 30) / 30, 0, 1);
            level = now > level ? now : level * 0.6f + now * 0.4f;

            // The valley follows the quiet moments between syllables and creeps up
            // 60 dB/s, so a held sound closes the mouth within a few tenths of a second.
            valley = float.IsNaN(valley) ? db : MathF.Min(db, valley + 60 * seconds);
            // 25 dB above it is a loud, stressed syllable; ordinary ones land in between.
            var s = db < -60 ? 0 : Math.Clamp((db - valley - 3) / 22, 0, 1);
            syllable = s > syllable ? s : syllable * 0.5f + s * 0.5f;

            // Something is playing when it's well above the background noise, which
            // drops at once and creeps up 1 dB/s (so a fan or hum doesn't count).
            noiseFloor = db < noiseFloor ? db : MathF.Min(noiseFloor + seconds, db);
            if (db > MathF.Max(noiseFloor + 12, -50)) lastSound = time.GetTimestamp();
        }
    }

    public void Reset()
    {
        lock (gate)
        {
            level = 0;
            peak = -50;
            valley = float.NaN;
            syllable = 0;
            noiseFloor = -70;
            lastSound = long.MinValue;
        }
    }

    public Snapshot Read()
    {
        lock (gate)
        {
            var since = lastSound == long.MinValue ? 1000 : time.GetElapsedTime(lastSound).TotalSeconds;
            return new Snapshot(level, syllable, since);
        }
    }
}
