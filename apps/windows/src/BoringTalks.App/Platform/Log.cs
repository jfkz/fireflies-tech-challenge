using System.Runtime.InteropServices;
using Serilog;

namespace BoringTalks.App.Platform;

/// <summary>The app's log: <c>%APPDATA%\BoringTalks\logs\boringtalks-YYYYMMDD.log</c>, a week of files.</summary>
public static class Log
{
    private static ILogger logger = new LoggerConfiguration().CreateLogger();

    public static void Start(string folder)
    {
        logger = new LoggerConfiguration()
            .MinimumLevel.Debug()
            .WriteTo.File(Path.Combine(folder, "boringtalks-.log"), rollingInterval: RollingInterval.Day, retainedFileCountLimit: 7,
                outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff} {Level:u3} [{Category}] {Message:lj}{NewLine}{Exception}")
            .CreateLogger();
    }

    /// <summary>A logger for one part of the app ("uploads", "recorder"…).</summary>
    public static Action<string> For(string category) => message => logger.ForContext("Category", category).Information(message);

    public static void Error(string category, string message, Exception? error = null) =>
        logger.ForContext("Category", category).Error(error, message);

    public static void Flush() => (logger as IDisposable)?.Dispose();
}

/// <summary>
/// The app is a Windows (not console) program, so command-line tools borrow the console of
/// the terminal that started them: <c>BoringTalks.exe --transcribe a.wav &gt; out.json</c> works.
/// </summary>
public static class ConsoleOutput
{
    [DllImport("kernel32.dll")]
    private static extern bool AttachConsole(int processId);

    private const int ParentProcess = -1;

    public static void Attach()
    {
        AttachConsole(ParentProcess);
        // Output that is redirected to a file keeps working without a console.
        Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true });
        Console.SetError(new StreamWriter(Console.OpenStandardError()) { AutoFlush = true });
    }

    public static void Status(string text) => Console.Error.WriteLine($"status: {text}");
}
