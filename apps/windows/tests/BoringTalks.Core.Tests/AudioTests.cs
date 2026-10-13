using BoringTalks.Core.Audio;
using Microsoft.Extensions.Time.Testing;

namespace BoringTalks.Core.Tests;

/// <summary>Test signals at 16 kHz unless said otherwise.</summary>
internal static class Signal
{
    public static float[] Sine(double hz, double seconds, int rate = 16000, float amplitude = 0.5f) =>
        [.. Enumerable.Range(0, (int)(seconds * rate)).Select(i => amplitude * MathF.Sin((float)(2 * Math.PI * hz * i / rate)))];

    /// <summary>A buzzy, voice-like tone: a fundamental and its harmonics, slightly gliding.</summary>
    public static float[] Voice(double hz, double seconds, int rate = 16000, float amplitude = 0.3f)
    {
        var samples = new float[(int)(seconds * rate)];
        double phase = 0;
        for (var i = 0; i < samples.Length; i++)
        {
            var f = hz * (1 + 0.02 * Math.Sin(2 * Math.PI * 3 * i / rate));
            phase += 2 * Math.PI * f / rate;
            double v = 0;
            for (var h = 1; h <= 8; h++) v += Math.Sin(h * phase) / h;
            samples[i] = (float)(amplitude * v / 2);
        }
        return samples;
    }

    public static float[] Silence(double seconds, int rate = 16000) => new float[(int)(seconds * rate)];

    public static float Rms(ReadOnlySpan<float> x)
    {
        double sum = 0;
        foreach (var v in x) sum += v * v;
        return x.IsEmpty ? 0 : (float)Math.Sqrt(sum / x.Length);
    }
}

public sealed class ResamplerTests
{
    [Fact]
    public void Brings_48_khz_down_to_16_khz_keeping_speech_frequencies()
    {
        var resampler = new Resampler(48000, 16000);
        var input = Signal.Sine(440, 1, 48000);
        // In uneven chunks, as WASAPI delivers them.
        var output = new List<float>();
        for (var at = 0; at < input.Length; at += 480 + at % 7) output.AddRange(resampler.Process(input.AsSpan(at, Math.Min(480 + at % 7, input.Length - at))));
        Assert.InRange(output.Count, 15900, 16000);
        // The tone comes through at full strength (RMS of a 0.5 sine ≈ 0.354).
        Assert.Equal(0.354f, Signal.Rms(output.Skip(200).Take(15000).ToArray()), 0.01f);
    }

    [Fact]
    public void Filters_out_what_16_khz_cannot_hold()
    {
        var resampler = new Resampler(48000, 16000);
        // 12 kHz would fold back to 4 kHz without the low-pass.
        var output = resampler.Process(Signal.Sine(12000, 1, 48000));
        Assert.True(Signal.Rms(output.AsSpan(200, 15000)) < 0.01f);
    }

    [Fact]
    public void Brings_16_khz_up_to_48_khz()
    {
        var resampler = new Resampler(16000, 48000);
        var output = resampler.Process(Signal.Sine(300, 1));
        Assert.InRange(output.Length, 47900, 48000);
        Assert.Equal(0.354f, Signal.Rms(output.AsSpan(500, 47000)), 0.01f);
    }

    [Fact]
    public void Same_rate_passes_through()
    {
        var resampler = new Resampler(16000, 16000);
        Assert.Equal([0.1f, 0.2f], resampler.Process([0.1f, 0.2f]));
        Assert.Equal(16000, resampler.InputRate);
        Assert.Equal(16000, resampler.OutputRate);
    }

    [Fact]
    public void Odd_rates_like_bluetooth_hands_free_work()
    {
        var resampler = new Resampler(44100, 16000);
        Assert.InRange(resampler.Process(Signal.Sine(200, 1, 44100)).Length, 15900, 16000);
        Assert.Throws<ArgumentOutOfRangeException>(() => new Resampler(0, 16000));
    }

    [Fact]
    public void Downmixes_interleaved_channels()
    {
        Assert.Equal([0.5f, 0f], Resampler.Downmix([1f, 0f, 0.5f, -0.5f], 2));
        Assert.Equal([0.3f], Resampler.Downmix([0.3f], 1));
    }
}

public sealed class LevelMeterTests
{
    [Fact]
    public void Rises_with_sound_and_notices_when_it_was_last_heard()
    {
        var clock = new FakeTimeProvider();
        var meter = new LevelMeter(clock);
        Assert.Equal(1000, meter.Read().SinceSound);
        for (var i = 0; i < 20; i++) meter.Push(Signal.Silence(0.02), 0.02f);
        Assert.Equal(0, meter.Read().Level);
        for (var i = 0; i < 10; i++) meter.Push(Signal.Voice(150, 0.02), 0.02f);
        var loud = meter.Read();
        Assert.True(loud.Level > 0.5f);
        Assert.Equal(0, loud.SinceSound, 3);

        clock.Advance(TimeSpan.FromSeconds(4));
        for (var i = 0; i < 20; i++) meter.Push(Signal.Silence(0.02), 0.02f);
        var quiet = meter.Read();
        Assert.True(quiet.Level < 0.2f);
        Assert.Equal(4, quiet.SinceSound, 3);

        meter.Reset();
        Assert.Equal(0, meter.Read().Level);
        meter.Push([], 0);
    }

    [Fact]
    public void Syllables_open_the_mouth_and_a_held_tone_closes_it()
    {
        var meter = new LevelMeter(new FakeTimeProvider());
        // A quiet room, not digital silence.
        for (var i = 0; i < 10; i++) meter.Push(Signal.Sine(3000, 0.02, amplitude: 0.001f), 0.02f);
        meter.Push(Signal.Voice(150, 0.02, amplitude: 0.5f), 0.02f);
        Assert.True(meter.Read().Syllable > 0.5f);
        for (var i = 0; i < 50; i++) meter.Push(Signal.Voice(150, 0.02, amplitude: 0.5f), 0.02f);
        Assert.True(meter.Read().Syllable < 0.2f);
    }
}
