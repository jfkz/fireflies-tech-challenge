namespace BoringTalks.Core.Tests;

public sealed class SilenceWatchTests
{
    private readonly SilenceWatch watch = new(300);

    [Fact]
    public void Listens_while_someone_talks()
    {
        Assert.Equal(new SilenceVerdict.Listening(), watch.Verdict(1000, 1010));
        Assert.Equal(new SilenceVerdict.Listening(), watch.Verdict(1000, 1239));
    }

    [Fact]
    public void Warns_in_the_last_minute()
    {
        Assert.Equal(new SilenceVerdict.Warning(60), watch.Verdict(1000, 1240));
        Assert.Equal(new SilenceVerdict.Warning(10), watch.Verdict(1000, 1290));
    }

    [Fact]
    public void Stops_at_the_limit()
    {
        Assert.Equal(new SilenceVerdict.Stop(), watch.Verdict(1000, 1300));
        Assert.Equal(new SilenceVerdict.Stop(), watch.Verdict(1000, 5000));
    }

    [Fact]
    public void Counts_from_the_start_when_nobody_was_ever_heard()
    {
        Assert.Equal(new SilenceVerdict.Warning(1), watch.Verdict(0, 299));
        Assert.Equal(new SilenceVerdict.Stop(), watch.Verdict(0, 300));
        Assert.Equal(10, watch.Quiet(-1000, 10));
    }

    [Fact]
    public void Keep_recording_restarts_the_count()
    {
        var kept = new SilenceWatch(300);
        kept.KeepRecording(1280);
        Assert.Equal(new SilenceVerdict.Listening(), kept.Verdict(1000, 1300));
        Assert.Equal(new SilenceVerdict.Stop(), kept.Verdict(1000, 1580));
        // Speech after it counts as usual, and an older "keep" never moves it back.
        kept.KeepRecording(1100);
        Assert.Equal(1280, kept.KeptAt);
        Assert.Equal(new SilenceVerdict.Listening(), kept.Verdict(1500, 1580));
    }

    [Fact]
    public void Off()
    {
        var off = new SilenceWatch(0);
        Assert.False(off.IsOn);
        Assert.Equal(new SilenceVerdict.Listening(), off.Verdict(0, 100_000));
    }

    [Fact]
    public void Short_limits_warn_for_half_of_it()
    {
        var shortLimit = new SilenceWatch(60);
        Assert.Equal(30, shortLimit.WarningLead);
        Assert.Equal(new SilenceVerdict.Listening(), shortLimit.Verdict(0, 29));
        Assert.Equal(new SilenceVerdict.Warning(30), shortLimit.Verdict(0, 30));
    }

    [Theory]
    [InlineData(300, "5 minutes")]
    [InlineData(60, "1 minute")]
    [InlineData(90, "90 seconds")]
    [InlineData(1, "1 second")]
    public void Describes_the_limit(double seconds, string text) => Assert.Equal(text, SilenceWatch.Describe(seconds));
}

public sealed class MicChoiceTests
{
    private static readonly MicChoice.Device Headset = new("bt", "Headset (MAJOR IV Hands-Free)", true, false);
    private static readonly MicChoice.Device BuiltIn = new("hd", "Microphone Array (Realtek Audio)", false, true);
    private static readonly MicChoice.Device Usb = new("usb", "Yeti", false, false);

    [Fact]
    public void A_bluetooth_default_uses_the_built_in_mic() => Assert.Equal(BuiltIn, MicChoice.Pick(Headset, [Headset, Usb, BuiltIn], true));

    [Fact]
    public void Falls_back_to_another_wired_mic() => Assert.Equal(Usb, MicChoice.Pick(Headset, [Headset, Usb], true));

    [Fact]
    public void Keeps_the_default_when_there_is_no_other_mic() => Assert.Null(MicChoice.Pick(Headset, [Headset], true));

    [Fact]
    public void Leaves_wired_defaults_alone()
    {
        Assert.Null(MicChoice.Pick(Usb, [Usb, BuiltIn], true));
        Assert.Null(MicChoice.Pick(null, [BuiltIn], true));
    }

    [Fact]
    public void Can_be_turned_off() => Assert.Null(MicChoice.Pick(Headset, [Headset, BuiltIn], false));

    [Theory]
    [InlineData("BTHENUM", "Headset", true, false)]
    [InlineData("BTHHFENUM", "Headset", true, false)]
    [InlineData("SWD", "Headset (WH-1000XM4 Hands-Free AG Audio)", true, false)]
    [InlineData("HDAUDIO", "Microphone Array", false, true)]
    [InlineData("INTELAUDIO", "Microphone Array", false, true)]
    [InlineData("USB", "Yeti", false, false)]
    [InlineData(null, null, false, false)]
    public void Classifies_endpoints_by_their_bus(string? bus, string? name, bool bluetooth, bool builtIn) =>
        Assert.Equal((bluetooth, builtIn), MicChoice.Classify(bus, name));
}

public sealed class RecordingJanitorTests
{
    [Fact]
    public void Deletes_only_old_unprotected_recordings()
    {
        using var folder = new TemporaryFolder();
        var now = DateTimeOffset.UtcNow;
        void Make(string name, double daysOld)
        {
            File.WriteAllBytes(folder.File(name), [1, 2, 3]);
            File.SetLastWriteTimeUtc(folder.File(name), (now - TimeSpan.FromDays(daysOld)).UtcDateTime);
        }
        Make("old.m4a", 10);
        Make("waiting.m4a", 10);
        Make("recent.m4a", 2);
        Make("notes.txt", 30);
        Assert.Equal(["old.m4a"], RecordingJanitor.Prune(folder.Path, 7, new HashSet<string> { "waiting.m4a" }, now));
        Assert.Equal(["notes.txt", "recent.m4a", "waiting.m4a"], Directory.GetFiles(folder.Path).Select(Path.GetFileName).Order(StringComparer.Ordinal));
        Assert.Equal(["recent.m4a", "waiting.m4a"], RecordingJanitor.Prune(folder.Path, 0, new HashSet<string>(), now));
        Assert.Empty(RecordingJanitor.Prune(folder.File("missing"), 0, new HashSet<string>(), now));
    }
}
