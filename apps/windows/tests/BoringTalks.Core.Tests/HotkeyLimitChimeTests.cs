using System.Net;
using System.Text.Json;
using BoringTalks.Core.Api;
using BoringTalks.Core.Audio;

namespace BoringTalks.Core.Tests;

public sealed class HotkeyTests
{
    [Theory]
    [InlineData("Ctrl+Alt+R", HotkeyModifiers.Control | HotkeyModifiers.Alt, "R", 0x52)]
    [InlineData(" control + shift + 7 ", HotkeyModifiers.Control | HotkeyModifiers.Shift, "7", 0x37)]
    [InlineData("Win+F9", HotkeyModifiers.Win, "F9", 0x78)]
    [InlineData("Alt+space", HotkeyModifiers.Alt, "Space", 0x20)]
    public void Reads_a_shortcut(string text, HotkeyModifiers modifiers, string key, int virtualKey)
    {
        var hotkey = Hotkey.Parse(text);
        Assert.Equal(new Hotkey(modifiers, key), hotkey);
        Assert.Equal(virtualKey, hotkey!.VirtualKey);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("R")]
    [InlineData("Ctrl+")]
    [InlineData("Hyper+R")]
    [InlineData("Ctrl+Tab")]
    [InlineData("Ctrl+F25")]
    public void Refuses_what_is_not_one(string? text) => Assert.Null(Hotkey.Parse(text));

    [Fact]
    public void Writes_modifiers_in_one_order_and_reads_what_it_writes()
    {
        var hotkey = Hotkey.Create(HotkeyModifiers.Win | HotkeyModifiers.Shift | HotkeyModifiers.Alt | HotkeyModifiers.Control, "D1")!;
        Assert.Equal("Ctrl+Alt+Shift+Win+1", hotkey.ToString());
        Assert.Equal(hotkey, Hotkey.Parse(hotkey.ToString()));
        Assert.Equal(Hotkey.Default, Hotkey.Parse(Hotkey.Default)!.ToString());
        Assert.Null(Hotkey.Create(HotkeyModifiers.None, "R"));
        Assert.Null(Hotkey.Create(HotkeyModifiers.Control, "LeftShift"));
    }
}

public sealed class RecordingLimitTests
{
    [Fact]
    public void Warns_in_the_last_five_minutes_then_stops()
    {
        var limit = new RecordingLimit(7200);
        Assert.Equal(new SilenceVerdict.Listening(), limit.Verdict(6899));
        Assert.Equal(new SilenceVerdict.Warning(300), limit.Verdict(6900));
        Assert.Equal(new SilenceVerdict.Stop(), limit.Verdict(7200));
        Assert.True(limit.IsOn);
    }

    [Fact]
    public void Warns_for_half_a_short_limit_and_never_without_one()
    {
        Assert.Equal(new SilenceVerdict.Warning(30), new RecordingLimit(60).Verdict(30));
        Assert.Equal(new SilenceVerdict.Listening(), new RecordingLimit(0).Verdict(1_000_000));
        Assert.False(new RecordingLimit(0).IsOn);
    }

    [Theory]
    [InlineData(7200, "2 hours")]
    [InlineData(3600, "1 hour")]
    [InlineData(5400, "90 minutes")]
    [InlineData(60, "1 minute")]
    public void Describes_the_limit(double seconds, string text) => Assert.Equal(text, RecordingLimit.Describe(seconds));
}

public sealed class ChimeTests
{
    [Fact]
    public void Is_a_short_quiet_mono_wav()
    {
        var wav = Chime.Wav(rising: true);
        Assert.Equal("RIFF", System.Text.Encoding.ASCII.GetString(wav, 0, 4));
        Assert.Equal("WAVE", System.Text.Encoding.ASCII.GetString(wav, 8, 4));
        Assert.Equal(1, BitConverter.ToInt16(wav, 22));
        Assert.Equal(Chime.SampleRate, BitConverter.ToInt32(wav, 24));
        var samples = (wav.Length - 44) / 2;
        Assert.Equal(Chime.Duration.TotalSeconds, samples / (double)Chime.SampleRate, 2);
        var peak = Enumerable.Range(0, samples).Max(i => Math.Abs((int)BitConverter.ToInt16(wav, 44 + i * 2)));
        Assert.InRange(peak, 4000, (int)(Chime.Peak * 32767) + 1);
        // Starts and ends silent: no click.
        Assert.Equal(0, BitConverter.ToInt16(wav, 44));
        Assert.InRange(Math.Abs((int)BitConverter.ToInt16(wav, wav.Length - 2)), 0, 400);
    }

    [Fact]
    public void Rises_to_start_and_falls_to_stop()
    {
        static double Pitch(float[] s) => s.Zip(s.Skip(1)).Count(p => p.First <= 0 && p.Second > 0) / (s.Length / (double)Chime.SampleRate);
        var up = Chime.Samples([659.25, 880.0]);
        var half = up.Length / 2;
        Assert.True(Pitch(up[..half]) < Pitch(up[half..]));
        Assert.NotEqual(Chime.Wav(rising: true), Chime.Wav(rising: false));
        Assert.InRange(Pitch(up[half..]), 860, 900);
    }
}

public sealed class MeTests
{
    [Fact]
    public async Task Reads_the_account_and_its_recording_limit()
    {
        var handler = new StubHandler((_, _) => (HttpStatusCode.OK, Fixture.Text("me")));
        var api = new ApiClient(new Uri("https://api.example.com"), new HttpClient(handler), _ => ValueTask.FromResult<string?>("btd_test"));
        var me = await api.GetMeAsync(TestContext.Current.CancellationToken);
        Assert.Equal("GET /me", handler.Requests.Single().Route);
        Assert.Equal("mike@example.com", me.Email);
        Assert.Equal(120, me.RecordingLimitMinutes(fallback: 5));
    }

    [Fact]
    public void Says_no_limit_or_leaves_it_to_the_fallback()
    {
        static Me Read(string json) => JsonSerializer.Deserialize<Me>(json, ApiJson.Options)!;
        Assert.Equal(0, Read("""{"id":"x","recordingLimitSec":null}""").RecordingLimitMinutes(120));
        Assert.Equal(120, Read("""{"id":"x"}""").RecordingLimitMinutes(120));
        Assert.Equal(1, Read("""{"id":"x","recordingLimitSec":20}""").RecordingLimitMinutes(120));
    }
}
