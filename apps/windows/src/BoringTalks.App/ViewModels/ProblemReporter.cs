using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using CommunityToolkit.Mvvm.ComponentModel;
using BoringTalks.App.Platform;
using BoringTalks.Core;
using BoringTalks.Core.Api;
using BoringTalks.Core.Reports;

namespace BoringTalks.App.ViewModels;

public enum ReportState
{
    Editing,
    Collecting,
    Sending,
    Sent,
    Saved,
}

/// <summary>
/// Report a Problem…, as on the Mac: what the user writes, plus the app's diagnostics and its own
/// log, sent to <c>POST /reports</c> or saved to a file when it can't be. Also keeps the watchdog's
/// last hang, which the menu offers to report. Lives on the UI thread.
/// </summary>
public sealed partial class ProblemReporter : ObservableObject
{
    private readonly IReportsApi api;
    private readonly AppFolders folders;
    private readonly HangStore hangStore;
    private readonly Action<string> log = Log.For("report");

    public ProblemReporter(IReportsApi api, AppFolders folders)
    {
        this.api = api;
        this.folders = folders;
        hangStore = new HangStore(Path.Combine(folders.Root, "last-hang.json"));
    }

    public HangStore HangStore => hangStore;

    /// <summary>Gathers the diagnostics (the <see cref="AppModel"/> knows the app's state).</summary>
    public Func<Task<IReadOnlyDictionary<string, string>>>? CollectDiagnostics { get; set; }

    /// <summary>The report window should open.</summary>
    public event Action? ShowWindowRequested;

    [ObservableProperty] public partial string Message { get; set; } = "";
    [ObservableProperty] public partial bool IncludeLog { get; set; } = true;
    [ObservableProperty] public partial ProblemReportKind Kind { get; private set; }
    /// <summary>The hang this report is about, when it is one.</summary>
    [ObservableProperty] public partial Hang? Hang { get; private set; }
    /// <summary>A hang not yet reported or dismissed (the menu shows it).</summary>
    [ObservableProperty] public partial Hang? PendingHang { get; private set; }
    [ObservableProperty] public partial ReportState State { get; private set; }
    /// <summary>After sending: the reference; after saving: the file.</summary>
    [ObservableProperty] public partial string? Result { get; private set; }
    [ObservableProperty] public partial string? Error { get; private set; }
    /// <summary>What is sent besides the message and the log, one "key: value" a line.</summary>
    [ObservableProperty] public partial string DiagnosticsText { get; private set; } = "Collecting…";

    public static string IncludeLogText => $"Include {AppFlavor.Current.Name}'s log (today and yesterday)";

    /// <summary>Above the message when the report is about a hang.</summary>
    public string? HangText => Hang is { } hang ? $"{Describe(hang)} Sending this helps find out why." : null;

    partial void OnHangChanged(Hang? value) => OnPropertyChanged(nameof(HangText));

    public bool IsBusy => State is ReportState.Collecting or ReportState.Sending;
    public bool IsDone => State is ReportState.Sent or ReportState.Saved;

    partial void OnStateChanged(ReportState value)
    {
        OnPropertyChanged(nameof(IsBusy));
        OnPropertyChanged(nameof(IsDone));
    }

    /// <summary>A hang from the last run (one that ended with the app being killed).</summary>
    public void Start() => PendingHang = hangStore.Load();

    /// <summary>The watchdog saw the UI thread come back.</summary>
    public void HangEnded(Hang hang) => PendingHang = hang;

    /// <summary>Opens the window for a new report, about <paramref name="hang"/> if given.</summary>
    public void Begin(Hang? hang = null)
    {
        if (!IsBusy)
        {
            State = ReportState.Editing;
            Error = null;
        }
        Kind = hang is null ? ProblemReportKind.User : ProblemReportKind.Hang;
        Hang = hang;
        ShowWindowRequested?.Invoke();
        _ = RefreshDiagnosticsAsync();
    }

    public void DismissHang()
    {
        PendingHang = null;
        hangStore.Clear();
    }

    /// <summary>"BoringTalks stopped responding for 7 min at 20:11." for the menu and the window.</summary>
    public static string Describe(Hang hang)
    {
        var at = hang.StartedAt.ToLocalTime().ToString("t", CultureInfo.CurrentCulture);
        return hang.Recovered
            ? $"{AppFlavor.Current.Name} stopped responding for {ProblemReport.Describe(hang.Seconds)} at {at}."
            : $"{AppFlavor.Current.Name} stopped responding at {at} and was closed while stuck.";
    }

    public async Task SendAsync()
    {
        if (IsBusy) return;
        Error = null;
        State = ReportState.Collecting;
        var report = await BuildAsync();
        State = ReportState.Sending;
        try
        {
            var response = await api.SendProblemReportAsync(report);
            log($"report {response.Id} sent");
            Finished();
            Result = $"Reference {response.Id[..Math.Min(8, response.Id.Length)]}.";
            State = ReportState.Sent;
        }
        catch (ApiException error)
        {
            log($"report not sent: {error.Message}");
            Error = error.Kind switch
            {
                ApiErrorKind.Unauthorized => "Sign in to send it, or save it to a file and send that.",
                // A server from before reports existed.
                ApiErrorKind.NotFound => "This server doesn't take reports yet. Use Save to File… and send the file instead.",
                _ => error.Message,
            };
            State = ReportState.Editing;
        }
    }

    /// <summary>Writes the report to Downloads and shows it in Explorer.</summary>
    public async Task SaveToFileAsync()
    {
        if (IsBusy) return;
        Error = null;
        State = ReportState.Collecting;
        var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        var file = Path.Combine(folder, $"{AppFlavor.Current.Name} report {DateTime.Now:yyyy-MM-dd HHmmss}.txt");
        try
        {
            Directory.CreateDirectory(folder);
            await WriteAsync(file);
            Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{file}\"") { UseShellExecute = true })?.Dispose();
            Finished();
            Result = file;
            State = ReportState.Saved;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        {
            Error = $"Couldn't save the report: {error.Message}";
            State = ReportState.Editing;
        }
    }

    /// <summary>Writes what would be sent to <paramref name="file"/>, without sending it (<c>--write-report</c>, for checking).</summary>
    public async Task WriteAsync(string file) => await File.WriteAllTextAsync(file, ProblemReport.Text(await BuildAsync()));

    /// <summary>The report is out: clear the draft and the hang it was about.</summary>
    private void Finished()
    {
        Message = "";
        if (Hang is not null) DismissHang();
        Hang = null;
    }

    private async Task<IReadOnlyDictionary<string, string>> RefreshDiagnosticsAsync()
    {
        var values = new Dictionary<string, string>(CollectDiagnostics is null ? new Dictionary<string, string>() : await CollectDiagnostics(), StringComparer.Ordinal);
        if (Hang is { } hang)
        {
            values["hang.startedAt"] = ApiJson.Format(hang.StartedAt);
            values["hang.seconds"] = ((int)Math.Round(hang.Seconds)).ToString(CultureInfo.InvariantCulture);
            values["hang.recovered"] = hang.Recovered ? "yes" : "no (the app was closed while stuck)";
        }
        DiagnosticsText = string.Join("\n", values.OrderBy(v => v.Key, StringComparer.Ordinal).Select(v => $"{v.Key}: {v.Value}"));
        return values;
    }

    private async Task<ProblemReportRequest> BuildAsync()
    {
        var diagnostics = await RefreshDiagnosticsAsync();
        var logs = folders.Logs;
        var text = IncludeLog ? await Task.Run(() => ProblemReport.Log(LogTail.Read(logs))) : "";
        var full = Assembly.GetEntryAssembly()?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? AppModel.Version;
        return ProblemReport.Fitted(new ProblemReportRequest(
            Kind,
            Message,
            new ProblemReportApp(AppModel.Version, full, AppFlavor.Current.IsDev ? "dev" : "release"),
            new ProblemReportSystem(SystemInfo.Os, SystemInfo.Model),
            diagnostics,
            text));
    }
}
