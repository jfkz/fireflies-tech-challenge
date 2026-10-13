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
                // The speech models live outside the install folder (so updates keep them); they go too.
                try
                {
                    Directory.Delete(AppFolders.Standard.Models, recursive: true);
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                {
                }
            })
            .Run();

        if (CommandLineTools.Run(args) is { } code) return code;

        // One BoringTalks per user: a second launch hands over its arguments (a sign-in link) and exits.
        var instance = SingleInstance.Claim();
        if (instance is null)
        {
            SingleInstance.Forward(args.Length == 0 ? ["--open"] : args);
            return 0;
        }

        Log.Start(AppFolders.Standard.Logs);
        Log.For("app")($"BoringTalks {ViewModels.AppModel.Version} starting");
        var app = new App(args, instance);
        app.InitializeComponent();
        return app.Run();
    }
}
