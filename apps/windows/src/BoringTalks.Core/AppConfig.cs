namespace BoringTalks.Core;

/// <summary>
/// Where the API and the dashboard live.
/// <para>
/// Production by default. For the dev environment set <c>apiUrl</c> and <c>webUrl</c> in
/// <c>%APPDATA%\BoringTalks\settings.json</c>, or launch with <c>--api-url</c> / <c>--web-url</c>.
/// Launch arguments win over settings.
/// </para>
/// </summary>
public sealed record AppConfig(Uri ApiUrl, Uri WebUrl)
{
    public static readonly Uri ProductionApi = new("https://api.boringtalks.lol");
    public static readonly Uri ProductionWeb = new("https://boringtalks.lol");

    public static AppConfig Production { get; } = new(ProductionApi, ProductionWeb);

    public static AppConfig Resolve(IReadOnlyList<string> arguments, string? apiUrl, string? webUrl)
    {
        string? Argument(string flag)
        {
            var index = arguments.ToList().FindIndex(a => a.Equals(flag, StringComparison.OrdinalIgnoreCase));
            return index >= 0 && index + 1 < arguments.Count ? arguments[index + 1] : null;
        }
        return new AppConfig(
            Url(Argument("--api-url")) ?? Url(apiUrl) ?? ProductionApi,
            Url(Argument("--web-url")) ?? Url(webUrl) ?? ProductionWeb);
    }

    private static Uri? Url(string? text) =>
        Uri.TryCreate(text?.Trim(), UriKind.Absolute, out var url) && url.Scheme is "https" or "http" && url.Host.Length > 0 ? url : null;

    /// <summary>The dashboard page of a meeting.</summary>
    public Uri MeetingUrl(string id) => new($"{WebUrl.ToString().TrimEnd('/')}/meetings/{Uri.EscapeDataString(id)}");

    public Uri DashboardUrl => new($"{WebUrl.ToString().TrimEnd('/')}/meetings");

    public bool IsProduction => ApiUrl == ProductionApi;
}

/// <summary>
/// Folders the app keeps its data in: <c>%APPDATA%\BoringTalks</c> for the queue, recordings and
/// settings, <c>%LOCALAPPDATA%\BoringTalks-Models</c> for the speech models (large, and per machine;
/// outside <c>%LOCALAPPDATA%\BoringTalks</c>, where the installer keeps the app and replaces it on update).
/// </summary>
public sealed record AppFolders(string Root, string ModelsRoot)
{
    public static AppFolders Standard { get; } = new(
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BoringTalks"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BoringTalks-Models"));

    public string Recordings => Path.Combine(Root, "Recordings");
    public string Models => ModelsRoot;
    public string Logs => Path.Combine(Root, "logs");
    public string UploadQueue => Path.Combine(Root, "uploads.json");
    public string Settings => Path.Combine(Root, "settings.json");

    public void Create()
    {
        foreach (var folder in new[] { Root, Recordings, Models, Logs }) Directory.CreateDirectory(folder);
    }
}
