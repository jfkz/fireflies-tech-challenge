using Velopack;

namespace BoringTalks.App;

public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        VelopackApp.Build().Run();
        if (CommandLineTools.Run(args) is { } code) return code;
        var app = new App();
        app.InitializeComponent();
        return app.Run();
    }
}
