namespace BoringTalks.Core;

/// <summary>
/// Where the API and the dashboard live.
/// <para>
/// The build's own environment by default (production; the dev environment for BoringTalks Dev).
/// Elsewhere: set <c>apiUrl</c> and <c>webUrl</c> in <c>settings.json</c>, or launch with
/// <c>--api-url</c> / <c>--web-url</c>. Launch arguments win over settings.
/// </para>
/// </summary>
public sealed record AppConfig(Uri ApiUrl, Uri WebUrl)
{
    public static readonly Uri ProductionApi = AppFlavor.Release.DefaultApi;
    public static readonly Uri ProductionWeb = AppFlavor.Release.DefaultWeb;

    public static AppConfig Production { get; } = new(ProductionApi, ProductionWeb);

    public static AppConfig Resolve(IReadOnlyList<string> arguments, string? apiUrl, string? webUrl, AppFlavor? flavor = null)
    {
        flavor ??= AppFlavor.Current;
        string? Argument(string flag)
        {
            var index = arguments.ToList().FindIndex(a => a.Equals(flag, StringComparison.OrdinalIgnoreCase));
            return index >= 0 && index + 1 < arguments.Count ? arguments[index + 1] : null;
        }
        return new AppConfig(
            Url(Argument("--api-url")) ?? Url(apiUrl) ?? flavor.DefaultApi,
            Url(Argument("--web-url")) ?? Url(webUrl) ?? flavor.DefaultWeb);
    }

    private static Uri? Url(string? text) =>
        Uri.TryCreate(text?.Trim(), UriKind.Absolute, out var url) && url.Scheme is "https" or "http" && url.Host.Length > 0 ? url : null;

    /// <summary>The dashboard page of a meeting.</summary>
    public Uri MeetingUrl(string id) => new($"{WebUrl.ToString().TrimEnd('/')}/meetings/{Uri.EscapeDataString(id)}");

    public Uri DashboardUrl => new($"{WebUrl.ToString().TrimEnd('/')}/meetings");

    public bool IsProduction => ApiUrl == ProductionApi;
}

/// <summary>
/// Folders the app keeps its data in: <c>%APPDATA%\BoringTalks</c> (BoringTalks Dev:
/// <c>BoringTalksDev</c>) for the queue, recordings and settings, <c>%LOCALAPPDATA%\BoringTalks-Models</c>
/// for the speech models (large, per machine and shared by both builds; outside
/// <c>%LOCALAPPDATA%\BoringTalks</c>, where the installer keeps the app and replaces it on update).
/// </summary>
public sealed record AppFolders(string Root, string ModelsRoot)
{
    public static AppFolders Standard { get; } = For(AppFlavor.Current);

    public static AppFolders For(AppFlavor flavor) => new(
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), flavor.Id),
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
