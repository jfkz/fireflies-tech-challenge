using BoringTalks.Core.Speech;
using SherpaOnnx;

namespace BoringTalks.Speech;

/// <summary>
/// Tells voices apart with sherpa-onnx: pyannote segmentation 3.0 says who speaks when
/// inside a phrase, a TitaNet-small embedding says who it is.
/// </summary>
public sealed class VoiceAnalyzer : IVoiceAnalyzer, IDisposable
{
    private const int Rate = 16000;
    private readonly OfflineSpeakerDiarization diarizer;
    private readonly SpeakerEmbeddingExtractor embedder;
    private readonly SemaphoreSlim diarizing = new(1, 1);
    private readonly SemaphoreSlim embedding = new(1, 1);

    public VoiceAnalyzer(string modelsFolder, int threads = 2, string? embeddingModel = null)
    {
        embeddingModel ??= Path.Combine(modelsFolder, ModelCatalog.Embedding, ModelCatalog.EmbeddingFile);
        var config = new OfflineSpeakerDiarizationConfig();
        config.Segmentation.Pyannote.Model = Path.Combine(modelsFolder, ModelCatalog.Segmentation, "model.onnx");
        config.Segmentation.NumThreads = threads;
        config.Segmentation.Provider = "cpu";
        config.Embedding.Model = embeddingModel;
        config.Embedding.NumThreads = threads;
        config.Embedding.Provider = "cpu";
        // Unknown number of people; a higher threshold merges more turns into one person.
        config.Clustering.NumClusters = -1;
        config.Clustering.Threshold = 0.6f;
        config.MinDurationOn = 0.3f;
        config.MinDurationOff = 0.5f;
        diarizer = new OfflineSpeakerDiarization(config);

        var extractor = new SpeakerEmbeddingExtractorConfig { Model = embeddingModel, NumThreads = threads, Provider = "cpu" };
        embedder = new SpeakerEmbeddingExtractor(extractor);
    }

    /// <summary>Who speaks when in a phrase, so each person's words become their own segment.</summary>
    public async Task<IReadOnlyList<VoiceTurn>> TurnsAsync(float[] phrase, CancellationToken cancellation = default)
    {
        if (phrase.Length == 0) return [new VoiceTurn(0, 0)];
        await diarizing.WaitAsync(cancellation);
        try
        {
            var segments = await Task.Run(() => diarizer.Process(VoiceTurns.Padded(phrase)), cancellation);
            return VoiceTurns.FromSpans(segments.Select(s => new SpeakerSpan(s.Speaker, s.Start, s.End)), phrase.Length);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            return [new VoiceTurn(0, phrase.Length)];
        }
        finally
        {
            diarizing.Release();
        }
    }

    /// <summary>One embedding for (the last 10 s of) a stretch of one voice; null under 0.3 s.</summary>
    public async Task<float[]?> EmbeddingAsync(ReadOnlyMemory<float> samples, CancellationToken cancellation = default)
    {
        if (samples.Length < Rate * 3 / 10) return null;
        var clip = samples.Length > Rate * 10 ? samples[^(Rate * 10)..].ToArray() : samples.ToArray();
        await embedding.WaitAsync(cancellation);
        try
        {
            return await Task.Run(() =>
            {
                using var stream = embedder.CreateStream();
                stream.AcceptWaveform(Rate, clip);
                stream.InputFinished();
                if (!embedder.IsReady(stream)) return null;
                var vector = embedder.Compute(stream);
                return vector.Any(v => v != 0) ? vector : null;
            }, cancellation);
        }
        finally
        {
            embedding.Release();
        }
    }

    public void Dispose()
    {
        diarizer.Dispose();
        embedder.Dispose();
        diarizing.Dispose();
        embedding.Dispose();
    }
}
