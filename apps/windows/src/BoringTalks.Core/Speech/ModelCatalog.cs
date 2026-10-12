namespace BoringTalks.Core.Speech;

/// <summary>One file of an on-device model, and where to get it.</summary>
/// <param name="RelativePath">Where it goes under the models folder.</param>
/// <param name="Urls">Mirrors to try in order.</param>
/// <param name="SizeBytes">Expected size; a file of any other size is downloaded again.</param>
/// <param name="Sha256">Expected SHA-256 (lower-case hex), checked once after the download.</param>
public sealed record ModelFile(string RelativePath, IReadOnlyList<Uri> Urls, long SizeBytes, string? Sha256 = null);

/// <summary>
/// The models the Windows app runs with sherpa-onnx, all on the CPU:
/// <list type="bullet">
/// <item>Parakeet TDT 0.6B v3 (int8): the same speech model the Mac app runs, 25 European languages, punctuation built in.</item>
/// <item>pyannote segmentation 3.0: who speaks when, inside a phrase.</item>
/// <item>NVIDIA TitaNet-small speaker embeddings: who it is. Picked over WeSpeaker ResNet34 and CAM++
/// on LibriSpeech test-clean: in simulated 2–4 person meetings it put 0.9 % of phrases on the wrong
/// speaker, against 2–12 % for the others (and 3.4 % for the Mac app's model).</item>
/// </list>
/// Files come from our download host first (they're mirrored there), then from where k2-fsa publishes them.
/// </summary>
public static class ModelCatalog
{
    public const string Parakeet = "parakeet-tdt-0.6b-v3-int8";
    public const string Segmentation = "pyannote-segmentation-3-0";
    public const string Embedding = "titanet";
    public const string EmbeddingFile = "nemo_en_titanet_small.onnx";

    private const string Mirror = "https://download.boringtalks.lol/models/";
    private const string HuggingFace = "https://huggingface.co/csukuangfj/";
    private const string K2Releases = "https://github.com/k2-fsa/sherpa-onnx/releases/download/";

    public static IReadOnlyList<ModelFile> Speech { get; } =
    [
        Hf(Parakeet, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8", "encoder.int8.onnx", 652_184_281, "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247"),
        Hf(Parakeet, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8", "decoder.int8.onnx", 11_845_275, "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e"),
        Hf(Parakeet, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8", "joiner.int8.onnx", 6_355_277, "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3"),
        Hf(Parakeet, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8", "tokens.txt", 93_939, "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d"),
    ];

    public static IReadOnlyList<ModelFile> Voices { get; } =
    [
        Hf(Segmentation, "sherpa-onnx-pyannote-segmentation-3-0", "model.onnx", 5_992_913, "220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079"),
        new($"{Embedding}/{EmbeddingFile}",
            [new($"{Mirror}{Embedding}/{EmbeddingFile}"), new($"{K2Releases}speaker-recongition-models/{EmbeddingFile}")],
            40_257_283, "ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e"),
    ];

    /// <summary>About how much the first launch downloads, for the progress text.</summary>
    public static long ApproximateBytes => Speech.Concat(Voices).Sum(f => f.SizeBytes);

    private static ModelFile Hf(string folder, string repository, string file, long size, string? sha256 = null) =>
        new($"{folder}/{file}", [new($"{Mirror}{folder}/{file}"), new($"{HuggingFace}{repository}/resolve/main/{file}")], size, sha256);

    /// <summary>A file that is there in full (any size when the size isn't pinned).</summary>
    public static bool IsPresent(ModelFile file, string modelsFolder)
    {
        var path = PathOf(file, modelsFolder);
        if (!File.Exists(path)) return false;
        var length = new FileInfo(path).Length;
        return file.SizeBytes <= 0 ? length > 0 : length == file.SizeBytes;
    }

    public static string PathOf(ModelFile file, string modelsFolder) => Path.Combine(modelsFolder, file.RelativePath.Replace('/', Path.DirectorySeparatorChar));
}
