using System.Diagnostics;
using System.Text.Encodings.Web;
using System.Text.Json;
using NAudio.Wave;
using BoringTalks.App.Platform;
using BoringTalks.Core;
using BoringTalks.Core.Api;
using BoringTalks.Core.Audio;
using BoringTalks.Core.Speech;
using BoringTalks.Core.Transcript;
using BoringTalks.Speech;

namespace BoringTalks.App.Recording;

/// <summary>Reads an audio file (WAV, MP3, M4A, FLAC… whatever Media Foundation opens) as 16 kHz mono.</summary>
public static class AudioFileReader
{
    public static float[] Read(string path)
    {
        using WaveStream reader = path.EndsWith(".wav", StringComparison.OrdinalIgnoreCase) ? new WaveFileReader(path) : new MediaFoundationReader(path);
        var provider = reader.ToSampleProvider();
        var samples = new List<float>();
        var buffer = new float[provider.WaveFormat.SampleRate * provider.WaveFormat.Channels];
        int read;
        while ((read = provider.Read(buffer, 0, buffer.Length)) > 0) samples.AddRange(buffer.AsSpan(0, read));
        var mono = Resampler.Downmix(samples.ToArray(), provider.WaveFormat.Channels);
        return new Resampler(provider.WaveFormat.SampleRate, 16000).Process(mono);
    }

    /// <summary>The samples in 0.1 s chunks, as a capture would deliver them.</summary>
    public static IEnumerable<float[]> Chunks(float[] samples)
    {
        for (var at = 0; at < samples.Length; at += 1600) yield return samples[at..Math.Min(samples.Length, at + 1600)];
    }
}

/// <summary>
/// <c>BoringTalks.exe --transcribe &lt;file&gt; [--speakers] [--mic &lt;file&gt;] [--language xx] [--realtime]</c>
/// <para>
/// Runs a file through the same pipeline as a meeting and prints the transcript JSON the app would
/// upload (<c>PUT /meetings/:id/transcript</c>) to stdout. Status goes to stderr.
/// <c>&lt;file&gt;</c> plays the part of system audio (the other people); <c>--speakers</c> tells the voices in it
/// apart ("Speaker 1…N"), without it they are all "Others"; <c>--mic</c> adds a second file as the microphone
/// ("You"); <c>--realtime</c> feeds the audio at the speed it plays, as a live meeting would (previews and
/// pitch cuts then behave exactly as live).
/// </para>
/// </summary>
public static class FileTranscriber
{
    public sealed record Options(string System, string? Mic, bool Speakers, string? Language, bool Realtime)
    {
        public static Options? Parse(string[] arguments)
        {
            string? Value(string flag)
            {
                var index = Array.FindIndex(arguments, a => a.Equals(flag, StringComparison.OrdinalIgnoreCase));
                return index >= 0 && index + 1 < arguments.Length ? arguments[index + 1] : null;
            }
            return Value("--transcribe") is { } path
                ? new Options(path, Value("--mic"), arguments.Contains("--speakers"), Value("--language"), arguments.Contains("--realtime"))
                : null;
        }
    }

    public static async Task<int> RunAsync(Options options)
    {
        var folders = AppFolders.Standard;
        using var http = new HttpClient();
        using var models = new SpeechModels(new ModelStore(folders.Models, http, ConsoleOutput.Status), ConsoleOutput.Status);
        var last = "";
        models.Changed += _ =>
        {
            if (models.Summary != last) ConsoleOutput.Status(last = models.Summary);
        };
        if (!await models.PrepareAsync() || models.Engine is null)
        {
            ConsoleOutput.Status($"the speech model couldn't load: {models.Summary}");
            return 1;
        }
        if (options.Speakers && models.Voices is null) ConsoleOutput.Status("voice models unavailable; speakers won't be told apart");

        var records = new List<PhraseRecord>();
        var gate = new Lock();
        double duration = 0;
        var clock = Stopwatch.StartNew();
        try
        {
            var inputs = new List<(AudioChannel Channel, float[] Samples)> { (AudioChannel.System, AudioFileReader.Read(options.System)) };
            if (options.Mic is { } mic) inputs.Add((AudioChannel.Microphone, AudioFileReader.Read(mic)));
            var registry = new VoiceRegistry();
            var recognizer = new ParakeetRecognizer(models.Engine);
            var trace = Environment.GetEnvironmentVariable("BT_TRACE") is not null ? (Action<string>)(t => Console.Error.WriteLine($"TRACE {t}")) : null;
            var transcribers = new List<PhraseTranscriber>();
            var feeds = new List<Task>();
            foreach (var (channel, samples) in inputs)
            {
                var analyzer = channel == AudioChannel.System && options.Speakers ? models.Voices : null;
                var transcriber = new PhraseTranscriber(recognizer, options.Language, e =>
                {
                    if (!e.IsFinal || e.Text.Length == 0) return;
                    lock (gate) records.Add(new PhraseRecord(channel, e.Speaker?.Voice, (int)(e.Start * 1000 / 16000), (int)(e.End * 1000 / 16000), e.Text));
                }, analyzer is null ? null : registry, analyzer, trace: trace);
                transcribers.Add(transcriber);
                duration = Math.Max(duration, samples.Length / 16000.0);
                feeds.Add(Task.Run(async () =>
                {
                    foreach (var chunk in AudioFileReader.Chunks(samples))
                    {
                        transcriber.Feed(chunk);
                        if (options.Realtime) await Task.Delay(TimeSpan.FromSeconds(chunk.Length / 16000.0));
                    }
                }));
            }
            await Task.WhenAll(feeds);
            foreach (var transcriber in transcribers)
            {
                await transcriber.FinishAsync();
                await transcriber.DisposeAsync();
            }
        }
        catch (Exception error) when (error is IOException or InvalidDataException or System.Runtime.InteropServices.COMException or FormatException)
        {
            ConsoleOutput.Status($"couldn't read the audio: {error.Message}");
            return 1;
        }

        var segments = SegmentAssembler.Assemble(records);
        var language = options.Language ?? LanguageGuess.Detect(string.Join(" ", segments.Select(s => s.Text)));
        var upload = new TranscriptUpload(language, (int)Math.Round(duration), segments);
        var pretty = new JsonSerializerOptions(ApiJson.Options) { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
        Console.WriteLine(JsonSerializer.Serialize(upload, pretty));
        ConsoleOutput.Status($"{segments.Count} segments, {segments.Select(s => s.Speaker).Distinct().Count()} speakers, {duration:0.0} s of audio in {clock.Elapsed.TotalSeconds:0.0} s");
        return 0;
    }
}
