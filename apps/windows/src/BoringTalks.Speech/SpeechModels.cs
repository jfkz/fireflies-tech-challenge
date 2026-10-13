using BoringTalks.Core.Speech;

namespace BoringTalks.Speech;

public abstract record ModelState
{
    public sealed record Idle : ModelState;
    public sealed record Loading(string Title, double? Fraction) : ModelState;
    public sealed record Ready : ModelState;
    public sealed record Failed(string Message) : ModelState;
}

/// <summary>
/// Downloads and loads the on-device models once per launch: Parakeet (about 670 MB) and the
/// voice models (about 46 MB), all in <c>%LOCALAPPDATA%\BoringTalks-Models</c>.
/// </summary>
public sealed class SpeechModels(ModelStore store, Action<string>? log = null) : IDisposable
{
    private readonly Lock gate = new();
    private Task<bool>? loading;

    public ModelState State { get; private set; } = new ModelState.Idle();
    public ParakeetEngine? Engine { get; private set; }
    /// <summary>Voices can be told apart (the speech model works without them).</summary>
    public VoiceAnalyzer? Voices { get; private set; }

    /// <summary>Raised (on any thread) when <see cref="State"/> changes.</summary>
    public event Action<ModelState>? Changed;

    public bool IsReady => State is ModelState.Ready;

    public string Summary => State switch
    {
        ModelState.Idle => "Not loaded",
        ModelState.Loading { Fraction: { } f } l => $"{l.Title}… {(int)(f * 100)}%",
        ModelState.Loading l => $"{l.Title}…",
        ModelState.Ready => Voices is null ? "Ready · Parakeet v3 (voices not separated)" : "Ready · Parakeet v3 + voice separation",
        ModelState.Failed f => $"Failed: {f.Message}",
        _ => "",
    };

    /// <summary>Starts loading (once) and returns whether the speech model is ready.</summary>
    public Task<bool> PrepareAsync()
    {
        lock (gate)
        {
            if (loading is { IsCompleted: false } || (loading is { } done && done.Result)) return loading;
            loading = Task.Run(LoadAsync);
            return loading;
        }
    }

    private async Task<bool> LoadAsync()
    {
        var downloading = !store.HasAll(ModelCatalog.Speech);
        Set(new ModelState.Loading(downloading ? "Downloading the speech model" : "Loading the speech model", downloading ? 0 : null));
        try
        {
            if (downloading) await store.EnsureAsync(ModelCatalog.Speech, new Progress<double>(f => Set(new ModelState.Loading("Downloading the speech model", f))));
            Set(new ModelState.Loading("Loading the speech model", null));
            Engine = new ParakeetEngine(store.Folder, threads: Math.Max(2, Math.Min(4, Environment.ProcessorCount / 2)));
        }
        catch (Exception error)
        {
            log?.Invoke($"speech model failed: {error}");
            Set(new ModelState.Failed(error.Message));
            return false;
        }
        Set(new ModelState.Loading("Loading the voice models", null));
        try
        {
            await store.EnsureAsync(ModelCatalog.Voices);
            Voices = new VoiceAnalyzer(store.Folder);
        }
        catch (Exception error)
        {
            // Still transcribe, just without telling the other people apart.
            log?.Invoke($"voice models unavailable: {error.Message}");
        }
        Set(new ModelState.Ready());
        log?.Invoke($"models ready (voices: {Voices is not null})");
        return true;
    }

    private void Set(ModelState state)
    {
        State = state;
        Changed?.Invoke(state);
    }

    public void Dispose()
    {
        Engine?.Dispose();
        Voices?.Dispose();
    }
}
