using Microsoft.Win32;
using BoringTalks.Core;

namespace BoringTalks.App.Platform;

/// <summary>
/// What BoringTalks registers with Windows, all per user (no admin rights): the
/// <c>boringtalks://</c> link the dashboard sends back after sign-in (BoringTalks Dev:
/// <c>boringtalks-dev://</c>), and opening at sign-in.
/// Written on every launch, so they follow the app when an update moves it.
/// </summary>
public static class Registration
{
    private static readonly string ProtocolKey = @"Software\Classes\" + AppFlavor.Current.Scheme;
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private static readonly string RunValue = AppFlavor.Current.Id;

    public static string Executable => Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "BoringTalks.exe");

    /// <summary>Makes <c>boringtalks://…</c> links open this app.</summary>
    public static void RegisterProtocol()
    {
        using var key = Registry.CurrentUser.CreateSubKey(ProtocolKey);
        key.SetValue("", $"URL:{AppFlavor.Current.Name} sign-in");
        key.SetValue("URL Protocol", "");
        using var icon = key.CreateSubKey("DefaultIcon");
        icon.SetValue("", $"\"{Executable}\",0");
        using var command = key.CreateSubKey(@"shell\open\command");
        command.SetValue("", $"\"{Executable}\" \"%1\"");
    }

    public static bool OpensAtSignIn
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey);
            return key?.GetValue(RunValue) is string;
        }
    }

    /// <summary>Starts BoringTalks (in the tray, quietly) when the user signs in to Windows.</summary>
    public static void SetOpenAtSignIn(bool open)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        if (open) key.SetValue(RunValue, $"\"{Executable}\" --background");
        else key.DeleteValue(RunValue, throwOnMissingValue: false);
    }

    /// <summary>On uninstall: nothing of BoringTalks stays in the registry.</summary>
    public static void Remove()
    {
        Registry.CurrentUser.DeleteSubKeyTree(ProtocolKey, throwOnMissingSubKey: false);
        SetOpenAtSignIn(false);
    }
}
