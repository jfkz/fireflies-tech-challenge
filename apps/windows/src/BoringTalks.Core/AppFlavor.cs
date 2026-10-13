using System.Reflection;

namespace BoringTalks.Core;

/// <summary>
/// Which build this is: BoringTalks, or BoringTalks Dev (the dev environment's build, like the Mac's).
/// The two install side by side: each has its own name, sign-in link scheme, data folder and default
/// API; they share the speech models. Chosen at build time (<c>-p:BoringTalksFlavor=dev</c>).
/// </summary>
/// <param name="UpdateFeed">Where Velopack finds newer builds (<c>releases.win.json</c> and the packages).</param>
public sealed record AppFlavor(string Name, string Scheme, string? ConnectApp, Uri DefaultApi, Uri DefaultWeb, Uri UpdateFeed)
{
    public static AppFlavor Release { get; } = new("BoringTalks", "boringtalks", null, new("https://api.boringtalks.lol"), new("https://boringtalks.lol"),
        new("https://download.boringtalks.lol/updates/windows/"));

    public static AppFlavor Dev { get; } = new("BoringTalks Dev", "boringtalks-dev", "dev", new("https://api.dev.boringtalks.lol"), new("https://dev.boringtalks.lol"),
        new("https://download.boringtalks.lol/dev/updates/windows/"));

    /// <summary>This process's build: the entry assembly's <c>BoringTalksFlavor</c> metadata.</summary>
    public static AppFlavor Current { get; } = Of(Assembly.GetEntryAssembly());

    public static AppFlavor Of(Assembly? assembly) =>
        Named(assembly?.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(a => a.Key == "BoringTalksFlavor")?.Value);

    public static AppFlavor Named(string? name) => string.Equals(name?.Trim(), "dev", StringComparison.OrdinalIgnoreCase) ? Dev : Release;

    public bool IsDev => ConnectApp == "dev";

    /// <summary>No spaces: folder, mutex, pipe and registry value names.</summary>
    public string Id => Name.Replace(" ", "", StringComparison.Ordinal);

    /// <summary>The other build, which may be installed next to this one.</summary>
    public AppFlavor Other => IsDev ? Release : Dev;
}
