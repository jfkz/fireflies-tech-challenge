namespace BoringTalks.Core.Calls;

/// <summary>
/// Reads which apps have the microphone open from Windows' microphone privacy records,
/// the same data behind the microphone icon in the taskbar:
/// <c>HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone</c>.
/// Store apps are subkeys named by package family ("MSTeams_8wekyb3d8bbwe"); desktop
/// apps are under <c>NonPackaged</c>, named by their path with '#' for '\'
/// ("C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe"). An app is using the microphone
/// while its <c>LastUsedTimeStart</c> is set and its <c>LastUsedTimeStop</c> is 0.
/// </summary>
public static class MicrophoneConsentStore
{
    public const string KeyPath = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
    public const string NonPackaged = "NonPackaged";

    /// <summary>One app's record: its subkey name and the two FILETIME values.</summary>
    public sealed record Entry(string KeyName, bool IsPackaged, long LastUsedTimeStart, long LastUsedTimeStop);

    /// <summary>The identity <see cref="CallApps.Identify"/> takes: a package family, or an executable path.</summary>
    public static string Identity(Entry entry) => entry.IsPackaged ? entry.KeyName : entry.KeyName.Replace('#', '\\');

    /// <summary>
    /// Apps holding the microphone right now, except <paramref name="self"/> (this app's
    /// own executable path), which would otherwise look like a call app while recording.
    /// </summary>
    public static IReadOnlyList<string> InUse(IEnumerable<Entry> entries, string? self = null) =>
        [.. entries
            .Where(e => e.LastUsedTimeStart > 0 && e.LastUsedTimeStop == 0)
            .Select(Identity)
            .Where(id => self is null || !id.Equals(self, StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)];
}
