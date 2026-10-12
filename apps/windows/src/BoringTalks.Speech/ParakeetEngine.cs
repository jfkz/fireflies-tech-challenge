using BoringTalks.Core.Speech;
using BoringTalks.Core.Transcript;
using SherpaOnnx;

namespace BoringTalks.Speech;

/// <summary>
/// NVIDIA Parakeet TDT 0.6B v3 through sherpa-onnx, on the CPU: 25 European languages,
/// punctuation built in, and it doesn't invent text for music or silence. One model shared
/// by both channels, used in turns.
/// </summary>
public sealed class ParakeetEngine : IDisposable
{
    private readonly OfflineRecognizer recognizer;
    private readonly SemaphoreSlim turn = new(1, 1);

    /// <param name="threads">Threads per transcription; two channels take turns, so a few is plenty.</param>
    public ParakeetEngine(string modelsFolder, int threads = 4)
    {
        string File(string name) => Path.Combine(modelsFolder, ModelCatalog.Parakeet, name);
        var config = new OfflineRecognizerConfig();
        config.FeatConfig.SampleRate = Rate;
        config.FeatConfig.FeatureDim = 80;
        config.ModelConfig.Transducer.Encoder = File("encoder.int8.onnx");
        config.ModelConfig.Transducer.Decoder = File("decoder.int8.onnx");
        config.ModelConfig.Transducer.Joiner = File("joiner.int8.onnx");
        config.ModelConfig.Tokens = File("tokens.txt");
        config.ModelConfig.ModelType = "nemo_transducer";
        config.ModelConfig.NumThreads = Math.Clamp(threads, 1, Environment.ProcessorCount);
        config.ModelConfig.Provider = "cpu";
        config.ModelConfig.Debug = 0;
        config.DecodingMethod = "greedy_search";
        recognizer = new OfflineRecognizer(config);
    }

    public const int Rate = 16000;

    /// <summary>The languages Parakeet v3 speaks, as ISO codes.</summary>
    public static IReadOnlyList<string> Languages { get; } =
        ["bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "it", "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "es", "sv", "ru", "uk"];

    /// <summary>
    /// Transcribes up to 15 s of 16 kHz mono audio. The model detects the language itself;
    /// the setting only goes with the transcript.
    /// </summary>
    public async Task<string> TranscribeAsync(float[] samples, CancellationToken cancellation = default)
    {
        if (samples.Length == 0) return "";
        await turn.WaitAsync(cancellation);
        try
        {
            return await Task.Run(() =>
            {
                using var stream = recognizer.CreateStream();
                stream.AcceptWaveform(Rate, samples);
                recognizer.Decode(stream);
                return TextCleaner.Clean(stream.Result.Text);
            }, cancellation);
        }
        finally
        {
            turn.Release();
        }
    }

    public void Dispose()
    {
        recognizer.Dispose();
        turn.Dispose();
    }
}

/// <summary>The transcriber's view of the shared engine.</summary>
public sealed class ParakeetRecognizer(ParakeetEngine engine) : IPhraseRecognizer
{
    public string Name => "Parakeet";
    // It doesn't need a second of speech to get the language right, unlike Whisper.
    public int MinimumPreview => ParakeetEngine.Rate * 6 / 10;

    public Task<string> TranscribeAsync(float[] samples, string? language, CancellationToken cancellation = default) =>
        engine.TranscribeAsync(samples, cancellation);
}
