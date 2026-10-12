namespace BoringTalks.Core.Speech;

/// <summary>One file of an on-device model, and where to get it.</summary>
/// <param name="RelativePath">Where it goes under the models folder.</param>
/// <param name="Urls">Mirrors to try in order.</param>
/// <param name="SizeBytes">Expected size; a file of any other size is downloaded again.</param>
public sealed record ModelFile(string RelativePath, IReadOnlyList<Uri> Urls, long SizeBytes);

/// <summary>
/// The models the Windows app runs with sherpa-onnx, all on the CPU:
/// <list type="bullet">
/// <item>Parakeet TDT 0.6B v3 (int8): the same speech model the Mac app runs, 25 European languages, punctuation built in.</item>
/// <item>pyannote segmentation 3.0: who speaks when, inside a phrase.</item>
/// <item>A WeSpeaker ResNet34 speaker embedding: who it is.</item>
/// </list>
/// Files come from our download host first (they're mirrored there), then from where k2-fsa publishes them.
/// </summary>
public static class ModelCatalog
{
    public const string Parakeet = "parakeet-tdt-0.6b-v3-int8";
    public const string Segmentation = "pyannote-segmentation-3-0";
    public const string Embedding = "wespeaker";

    private const string Mirror = "https://download.boringtalks.lol/models/";
    private const string HuggingFace = "https://huggingface.co/csukuangfj/";
    private const string K2Releases = "https://github.com/k2-fsa/sherpa-onnx/releases/download/";

    public static IReadOnlyList<ModelFile> Speech { get; } =
    [
        Hf(Parakeet, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8", "encoder.int8.onnx", 652_000_000),
        Hf(Parakeet, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8", "decoder.int8.onnx", 11_800_000),
        Hf(Parakeet, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8", "joiner.int8.onnx", 6_400_000),
        Hf(Parakeet, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8", "tokens.txt", 0),
    ];

    public static IReadOnlyList<ModelFile> Voices { get; } =
    [
        Hf(Segmentation, "sherpa-onnx-pyannote-segmentation-3-0", "model.onnx", 0),
        new($"{Embedding}/wespeaker_en_voxceleb_resnet34_LM.onnx",
            [new($"{Mirror}{Embedding}/wespeaker_en_voxceleb_resnet34_LM.onnx"), new($"{K2Releases}speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx")],
            0),
    ];

    /// <summary>About how much the first launch downloads, for the progress text.</summary>
    public static long ApproximateBytes => 700_000_000;

    private static ModelFile Hf(string folder, string repository, string file, long size) =>
        new($"{folder}/{file}", [new($"{Mirror}{folder}/{file}"), new($"{HuggingFace}{repository}/resolve/main/{file}")], size);

    /// <summary>A file that is there in full (any size when the size isn't pinned).</summary>
    public static bool IsPresent(ModelFile file, string modelsFolder)
    {
        var path = Path.Combine(modelsFolder, file.RelativePath);
        if (!File.Exists(path)) return false;
        var length = new FileInfo(path).Length;
        return file.SizeBytes <= 0 ? length > 0 : Math.Abs(length - file.SizeBytes) <= file.SizeBytes / 50;
    }
}
