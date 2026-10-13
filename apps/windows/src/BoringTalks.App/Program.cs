using BoringTalks.App.Platform;
using BoringTalks.Core;
using Velopack;

namespace BoringTalks.App;

public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        // Install, update and uninstall hooks run here and exit.
        VelopackApp.Build()
            .OnBeforeUninstallFastCallback(_ =>
            {
                Registration.Remove();
                Notifier.Uninstall();
                // The speech models live outside the install folder (so updates keep them); they go
                // too, unless the other build (BoringTalks / BoringTalks Dev) still uses them.
                try
                {
                    if (!Directory.Exists(AppFolders.For(AppFlavor.Current.Other).Root)) Directory.Delete(AppFolders.Standard.Models, recursive: true);
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                {
                }
            })
            .Run();

        if (CommandLineTools.Run(args) is { } code) return code;

        // One BoringTalks per user, of either build. The updater's restart waits for the old one to exit.
        var (result, instance) = SingleInstance.Claim(args.Contains("--after-update") ? SingleInstance.AfterUpdateWait : TimeSpan.Zero);
        if (result == ClaimResult.SameRunning)
        {
            // Running already: hand over the arguments (a sign-in link) and exit.
            SingleInstance.Forward(args.Length == 0 ? ["--open"] : args);
            return 0;
        }
        if (result == ClaimResult.OtherRunning)
        {
            if (!SwitchFromOtherBuild(out instance)) return 0;
        }

        Log.Start(AppFolders.Standard.Logs);
        Log.For("app")($"{AppFlavor.Current.Name} {ViewModels.AppModel.Version} starting");
        var app = new App(args, instance!);
        app.InitializeComponent();
        var exitCode = app.Run();
        Log.Flush();
        // A capture thread stuck in an audio driver must not keep the process, and its tray icon, alive.
        Environment.Exit(exitCode);
        return exitCode;
    }

    /// <summary>The other build is running: two would record the same calls, so offer to quit it.</summary>
    private static bool SwitchFromOtherBuild(out SingleInstance? instance)
    {
        instance = null;
        var me = AppFlavor.Current;
        var other = me.Other;
        var answer = System.Windows.MessageBox.Show(
            $"{other.Name} is running. Only one BoringTalks can record at a time.\n\nQuit {other.Name} and open {me.Name}?",
            me.Name, System.Windows.MessageBoxButton.YesNo, System.Windows.MessageBoxImage.Question);
        if (answer != System.Windows.MessageBoxResult.Yes) return false;
        SingleInstance.Forward(["--quit"], other);
        (var result, instance) = SingleInstance.Claim(TimeSpan.FromSeconds(20));
        if (result == ClaimResult.Claimed) return true;
        System.Windows.MessageBox.Show($"{other.Name} didn't quit. Quit it from its tray icon, then open {me.Name} again.", me.Name);
        return false;
    }
}
