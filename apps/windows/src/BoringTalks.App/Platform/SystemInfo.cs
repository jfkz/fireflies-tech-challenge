using Microsoft.Win32;

namespace BoringTalks.App.Platform;

/// <summary>Which Windows and which PC, for a problem report.</summary>
public static class SystemInfo
{
    /// <summary>"Windows 11 Pro 23H2 (10.0.22631)".</summary>
    public static string Os { get; } = ReadOs();

    /// <summary>The PC's maker and model from its firmware: "LENOVO 21HM"; empty when unknown.</summary>
    public static string Model { get; } = ReadModel();

    private static string ReadOs()
    {
        var version = Environment.OSVersion.Version;
        var number = $"{version.Major}.{version.Minor}.{version.Build}";
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
            var product = key?.GetValue("ProductName") as string ?? "Windows";
            // Windows 11 still calls itself "Windows 10" here; its builds start at 22000.
            if (version.Build >= 22000) product = product.Replace("Windows 10", "Windows 11", StringComparison.Ordinal);
            var release = key?.GetValue("DisplayVersion") as string;
            return $"{product}{(string.IsNullOrEmpty(release) ? "" : $" {release}")} ({number})";
        }
        catch (Exception error) when (error is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
            return $"Windows ({number})";
        }
    }

    private static string ReadModel()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\BIOS");
            var parts = new[] { key?.GetValue("SystemManufacturer") as string, key?.GetValue("SystemProductName") as string };
            return string.Join(" ", parts.Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => p!.Trim()));
        }
        catch (Exception error) when (error is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
            return "";
        }
    }
}
