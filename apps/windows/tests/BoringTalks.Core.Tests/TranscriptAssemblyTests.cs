using System.Text.Json;
using System.Text.Json.Nodes;
using BoringTalks.Core.Api;
using BoringTalks.Core.Audio;
using BoringTalks.Core.Transcript;
using Microsoft.Extensions.Time.Testing;

namespace BoringTalks.Core.Tests;

public sealed class SegmentAssemblerTests
{
    private static PhraseRecord Mic(int start, int end, string text) => new(AudioChannel.Microphone, null, start, end, text);
    private static PhraseRecord System(int start, int end, string text, int? voice) => new(AudioChannel.System, voice, start, end, text);

    [Fact]
    public void Orders_both_channels_by_time_and_labels_speakers()
    {
        // Arrival order is per channel (each transcriber finishes on its own).
        var segments = SegmentAssembler.Assemble(
        [
            Mic(4_000, 6_000, "Yes, we can see it."),
            Mic(15_000, 17_000, "I'll send the notes."),
            System(0, 3_500, "Can everyone see my screen?", 7),
            System(7_000, 10_000, "Pricing first.", 3),
            System(11_000, 14_000, "Sounds good.", 7),
        ]);
        Assert.Equal(["Speaker 1", "You", "Speaker 2", "Speaker 1", "You"], segments.Select(s => s.Speaker));
        Assert.Equal([0, 4_000, 7_000, 11_000, 15_000], segments.Select(s => s.StartMs));
        Assert.Equal(new Segment("Speaker 1", 0, 3_500, "Can everyone see my screen?"), segments[0]);
    }

    [Fact]
    public void Speaker_numbers_follow_first_appearance_not_voice_ids()
    {
        var segments = SegmentAssembler.Assemble([System(5_000, 6_000, "Second voice.", 1), System(0, 1_000, "First voice.", 2)]);
        Assert.Equal(["Speaker 1", "Speaker 2"], segments.Select(s => s.Speaker));
        Assert.Equal(["First voice.", "Second voice."], segments.Select(s => s.Text));
    }

    [Fact]
    public void An_unknown_voice_borrows_the_nearest_system_speaker()
    {
        var segments = SegmentAssembler.Assemble(
        [
            System(0, 1_000, "Haha.", null),
            System(2_000, 3_000, "Right, so.", 4),
            Mic(3_500, 4_000, "Mm-hm."),
            System(5_000, 5_500, "Yeah.", null),
        ]);
        Assert.Equal(["Speaker 1", "Speaker 1", "You", "Speaker 1"], segments.Select(s => s.Speaker));
    }

    [Fact]
    public void No_voices_at_all_is_others()
    {
        var segments = SegmentAssembler.Assemble([System(0, 1_000, "Hello.", null), Mic(2_000, 3_000, "Hi.")]);
        Assert.Equal(["Others", "You"], segments.Select(s => s.Speaker));
    }

    [Fact]
    public void Drops_microphone_echo_of_the_speakers()
    {
        var segments = SegmentAssembler.Assemble(
        [
            System(10_000, 14_000, "We launch on November third unless legal objects.", 1),
            // The laptop microphone heard the same words a moment later.
            Mic(10_400, 14_600, "we launch on november third unless legal"),
            // The user talking over them is kept.
            Mic(12_000, 13_000, "Wait, which year?"),
            // Far from any system phrase: kept.
            Mic(40_000, 41_000, "We launch on November third."),
        ]);
        Assert.Equal(["Speaker 1", "You", "You"], segments.Select(s => s.Speaker));
        Assert.Equal("Wait, which year?", segments[1].Text);
        Assert.Equal(2, SegmentAssembler.Assemble([System(10_000, 14_000, "We launch on November third.", 1), Mic(10_400, 14_600, "We launch on November third.")], dropEcho: false).Count);
        Assert.False(SegmentAssembler.IsEcho(Mic(0, 1, "…"), [System(0, 1, "…", 1)]));
    }

    [Fact]
    public void Cleans_text_and_times()
    {
        var segments = SegmentAssembler.Assemble(
        [
            Mic(-50, -100, "  spaced \n  out  "),
            Mic(1_000, 2_000, "   "),
            System(3_000, 4_000, new string('a', 12_000), 1),
        ]);
        Assert.Equal(2, segments.Count);
        Assert.Equal(new Segment("You", 0, 0, "spaced out"), segments[0]);
        Assert.Equal(10_000, segments[1].Text.Length);
    }

    [Fact]
    public void Segments_encode_like_the_shared_schema()
    {
        var upload = new TranscriptUpload("en", 65, [new("Speaker 1", 0, 4_200, "Can everyone see my screen?"), new("You", 4_500, 6_100, "Yes, go ahead.")]);
        Assert.True(JsonNode.DeepEquals(Fixture.Json("transcript-upload"), JsonSerializer.SerializeToNode(upload, ApiJson.Options)));
    }

    [Fact]
    public void Labels_are_stable()
    {
        var labeler = new SpeakerLabeler();
        Assert.Equal("Speaker 1", labeler.Label(AudioChannel.System, 9));
        Assert.Equal("You", labeler.Label(AudioChannel.Microphone, null));
        Assert.Equal("Speaker 2", labeler.Label(AudioChannel.System, 2));
        Assert.Equal("Speaker 1", labeler.Label(AudioChannel.System, 9));
        Assert.Null(labeler.Label(AudioChannel.System, null));
    }
}

public sealed class ChannelTimelineTests
{
    [Fact]
    public void On_time_audio_gets_no_silence()
    {
        var timeline = new ChannelTimeline();
        Assert.Equal(0, timeline.SilenceBefore(1_600, 0.1));
        Assert.Equal(0, timeline.SilenceBefore(1_600, 0.2));
        // A little jitter is tolerated.
        Assert.Equal(0, timeline.SilenceBefore(1_600, 0.6));
        Assert.Equal(4_800, timeline.Written);
    }

    [Fact]
    public void A_late_start_and_dropouts_are_filled_with_silence()
    {
        var timeline = new ChannelTimeline();
        // The capture started 2 s after the meeting.
        Assert.Equal(32_000, timeline.SilenceBefore(1_600, 2.1));
        Assert.Equal(2_100, timeline.Milliseconds(timeline.Written));
        // A device change: nothing from 2.1 s to 5.0 s.
        Assert.Equal(3 * 16_000 - 1_600, timeline.SilenceBefore(1_600, 5.1));
        Assert.Equal(5_100, timeline.Milliseconds(timeline.Written));
    }

    [Fact]
    public void Catches_up_only_when_well_behind()
    {
        var timeline = new ChannelTimeline();
        Assert.Equal(0, timeline.CatchUp(1.0));
        Assert.Equal(32_000, timeline.CatchUp(2.0));
        Assert.Equal(0, timeline.CatchUp(2.5));
        // Audio that arrives after the catch-up isn't padded again.
        Assert.Equal(0, timeline.SilenceBefore(1_600, 2.1));
    }
}

public sealed class AudioMixerTests
{
    private static AudioMixer Mixer(IEnumerable<AudioChannel>? channels = null)
    {
        var mixer = new AudioMixer(channels);
        mixer.Gains[AudioChannel.Microphone] = 1;
        mixer.Gains[AudioChannel.System] = 1;
        return mixer;
    }

    [Fact]
    public void Mixes_as_far_as_both_channels_got()
    {
        var mixer = Mixer();
        mixer.Append([0.1f, 0.1f, 0.1f], AudioChannel.Microphone);
        Assert.Empty(mixer.Drain());
        mixer.Append([0.2f, 0.2f], AudioChannel.System);
        var mixed = mixer.Drain();
        Assert.Equal(2, mixed.Length);
        Assert.Equal(0.3f, mixed[0], 1e-6f);
        mixer.Append([0.5f], AudioChannel.System);
        Assert.Equal(0.6f, mixer.Drain()[0], 1e-6f);
    }

    [Fact]
    public void Flush_and_removed_channels()
    {
        var mixer = Mixer();
        mixer.Append([0.1f, 0.1f, 0.1f], AudioChannel.Microphone);
        mixer.Append([0.1f], AudioChannel.System);
        Assert.Equal(3, mixer.Drain(flush: true).Length);
        mixer.Remove(AudioChannel.System);
        mixer.Append([0.4f, 0.4f], AudioChannel.Microphone);
        mixer.Append([0.9f], AudioChannel.System);
        Assert.Equal([0.4f, 0.4f], mixer.Drain());
        mixer.Remove(AudioChannel.Microphone);
        Assert.Empty(mixer.Drain(flush: true));
    }

    [Fact]
    public void A_channel_that_stops_delivering_counts_as_silent_instead_of_piling_up_the_other()
    {
        var mixer = new AudioMixer(maxLagSamples: 4);
        Assert.Equal(AudioMixer.DefaultMaxLag, new AudioMixer().MaxLagSamples);
        mixer.Append([0.1f, 0.1f, 0.1f, 0.1f], AudioChannel.Microphone);
        Assert.Empty(mixer.Drain());
        mixer.Append([0.1f], AudioChannel.Microphone);
        // Five samples ahead of a channel that sent nothing: written with silence for the other.
        Assert.Equal(5, mixer.Drain().Length);
        Assert.Equal(5, mixer.PaddedSamples);
        mixer.Append([0.2f], AudioChannel.System);
        mixer.Append([0.1f], AudioChannel.Microphone);
        Assert.Single(mixer.Drain());
        Assert.Equal(5, mixer.PaddedSamples);
    }

    [Fact]
    public void Loud_overlap_is_limited()
    {
        var mixer = Mixer();
        mixer.Append([0.9f, -0.9f], AudioChannel.Microphone);
        mixer.Append([0.9f, -0.9f], AudioChannel.System);
        var mixed = mixer.Drain();
        Assert.All(mixed, v => Assert.InRange(MathF.Abs(v), 0, 1));
        Assert.True(mixed[0] > 0.9f);
        Assert.True(mixed[1] < -0.9f);
    }

    [Fact]
    public void Without_levelling_both_sides_pass_unchanged()
    {
        var mixer = new AudioMixer([AudioChannel.Microphone]);
        mixer.Append([0.5f], AudioChannel.Microphone);
        Assert.Equal(0.5f, mixer.Drain()[0], 1e-6f);
    }

    private static float[] Tone(float amplitude, int samples) =>
        [.. Enumerable.Range(0, samples).Select(i => amplitude * MathF.Sin(i * 2 * MathF.PI * 220 / 16000))];

    private static float Rms(ReadOnlySpan<float> samples)
    {
        double sum = 0;
        foreach (var s in samples) sum += s * s;
        return (float)Math.Sqrt(sum / samples.Length);
    }

    [Fact]
    public void A_quiet_voice_is_brought_up_to_the_target_level()
    {
        var leveler = new SpeechLeveler();
        // A quiet microphone: about −32 dBFS of speech for 5 s.
        var output = leveler.Process(Tone(0.035f, 16000 * 5));
        Assert.Equal(16000 * 5, output.Length);
        Assert.InRange(leveler.Gain, 2.5f, 4f);
        Assert.InRange(Rms(output.AsSpan(^16000..)), 0.07f, 0.11f);
    }

    [Fact]
    public void A_loud_voice_is_brought_down_but_never_below_half()
    {
        var leveler = new SpeechLeveler();
        leveler.Process(Tone(0.9f, 16000 * 5));
        Assert.InRange(leveler.Gain, 0.5f, 0.55f);
    }

    [Fact]
    public void Silence_leaves_the_gain_alone_and_nothing_is_lost()
    {
        var leveler = new SpeechLeveler();
        leveler.Process(Tone(0.035f, 16000 * 3));
        var gain = leveler.Gain;
        var quiet = leveler.Process(new float[16000 * 2 + 50]);
        Assert.Equal(gain, leveler.Gain);
        Assert.Equal(16000 * 2, quiet.Length);
        Assert.Equal(50, leveler.Flush().Length);
        Assert.Empty(leveler.Flush());
    }

    [Fact]
    public void The_mixer_levels_each_side_and_flushes_the_rest_at_the_end()
    {
        var mixer = new AudioMixer(level: true);
        mixer.Append(Tone(0.035f, 16000 * 4 + 10), AudioChannel.Microphone);
        mixer.Append(Tone(0.1f, 16000 * 4 + 10), AudioChannel.System);
        var mixed = mixer.Drain();
        Assert.Equal(16000 * 4, mixed.Length);
        Assert.Equal(10, mixer.Drain(flush: true).Length);
    }

    [Fact]
    public void Stereo_puts_the_microphone_left_and_the_pc_right_unmixed()
    {
        var mixer = new AudioMixer(stereo: true);
        Assert.Equal(2, mixer.Channels);
        mixer.Append([0.1f, 0.2f, 0.3f], AudioChannel.Microphone);
        Assert.Empty(mixer.Drain());
        mixer.Append([-0.5f, 2f], AudioChannel.System);
        Assert.Equal([0.1f, -0.5f, 0.2f, 1f], mixer.Drain());
        // The end of the meeting: what only one side has, with silence on the other.
        Assert.Equal([0.3f, 0f], mixer.Drain(flush: true));
    }

    [Fact]
    public void Stereo_without_a_side_that_never_started_keeps_that_side_silent()
    {
        var mixer = new AudioMixer(stereo: true);
        mixer.Remove(AudioChannel.Microphone);
        mixer.Append([0.25f, 0.5f], AudioChannel.System);
        Assert.Equal([0f, 0.25f, 0f, 0.5f], mixer.Drain());
        Assert.Equal(1, new AudioMixer().Channels);
    }
}

public sealed class LanguageGuessTests
{
    [Theory]
    [InlineData("Good morning everyone, let's go over the launch plan for the new pricing page.", "en")]
    [InlineData("Доброе утро, давайте обсудим план запуска новой страницы с ценами.", "ru")]
    [InlineData("Добрий ранок, давайте обговоримо план запуску нової сторінки з цінами.", "uk")]
    [InlineData("Guten Morgen, wir sprechen heute über den Plan und die neue Seite, die wir nicht vergessen.", "de")]
    [InlineData("Bonjour à tous, nous allons parler du plan pour la nouvelle page et des prix.", "fr")]
    [InlineData("Buenos días a todos, vamos a hablar del plan para la nueva página y los precios.", "es")]
    [InlineData("Καλημέρα σε όλους, ας μιλήσουμε για το σχέδιο.", "el")]
    public void Detects_the_language_of_long_enough_text(string text, string language) => Assert.Equal(language, LanguageGuess.Detect(text));

    [Theory]
    [InlineData("Okay.")]
    [InlineData("Zoom Teams Slack Discord")]
    public void Says_nothing_when_unsure(string text) => Assert.Null(LanguageGuess.Detect(text));
}

public sealed class TextCleanerTests
{
    [Theory]
    [InlineData("  Hello   world  ", "Hello world")]
    [InlineData("[Music] Okay (laughs) so *coughs* we start ♪♪ now <unk>", "Okay so we start now")]
    [InlineData("Thanks for watching!", "")]
    [InlineData("Субтитры сделал DimaTorzok", "")]
    [InlineData("...", "")]
    [InlineData("[Applause]", "")]
    public void Removes_markers_and_invented_phrases(string text, string expected) => Assert.Equal(expected, TextCleaner.Clean(text));
}

public sealed class LiveTranscriptTests
{
    [Fact]
    public void Shows_finished_lines_and_one_preview_per_side()
    {
        var clock = new FakeTimeProvider();
        var live = new LiveTranscript(clock);
        var changes = 0;
        live.Changed += () => changes++;
        Assert.Equal(1000, live.SinceSpeech(AudioChannel.System));

        live.Receive("Can everyone", false, AudioChannel.System, null, 0);
        Assert.Equal("Others", live.Previews[AudioChannel.System].Speaker);
        var previewId = live.Previews[AudioChannel.System].Id;
        live.Receive("Can everyone see", false, AudioChannel.System, 4, 0);
        Assert.Equal(previewId, live.Previews[AudioChannel.System].Id);
        Assert.Equal("Speaker 1", live.Previews[AudioChannel.System].Speaker);
        live.Receive("Can everyone see my screen?", true, AudioChannel.System, 4, 0);
        Assert.Empty(live.Previews);
        // Words whose voice isn't known yet go to the last system speaker.
        live.Receive("Hello?", true, AudioChannel.System, null, 2_000);
        live.Receive("Yes.", true, AudioChannel.Microphone, null, 3_000);
        live.Receive("   ", true, AudioChannel.Microphone, null, 4_000);
        live.Receive("", false, AudioChannel.Microphone, null, 4_000);
        Assert.Equal(["Speaker 1", "Speaker 1", "You"], live.Lines.Select(l => l.Speaker));
        Assert.True(changes >= 5);

        clock.Advance(TimeSpan.FromSeconds(2));
        Assert.Equal(2, live.SinceSpeech(AudioChannel.Microphone), 3);
    }

    [Fact]
    public void Keeps_the_last_300_lines()
    {
        var live = new LiveTranscript();
        for (var i = 0; i < 320; i++) live.Receive($"Line {i}", true, AudioChannel.Microphone, null, i);
        Assert.Equal(LiveTranscript.Keep, live.Lines.Count);
        Assert.Equal("Line 20", live.Lines[0].Text);
    }

    [Fact]
    public void The_demo_script()
    {
        var live = new LiveTranscript();
        live.ShowDemo();
        Assert.Equal(6, live.Lines.Count);
        Assert.Equal(["Speaker 1", "You", "Speaker 2", "Speaker 1", "Speaker 2", "You"], live.Lines.Select(l => l.Speaker));
        Assert.True(live.Previews.ContainsKey(AudioChannel.System));
        live.Reset();
        Assert.Empty(live.Lines);
    }
}
