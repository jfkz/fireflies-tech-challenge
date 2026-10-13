using System.ComponentModel;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using CommunityToolkit.Mvvm.ComponentModel;
using BoringTalks.App.ViewModels;
using BoringTalks.Core;
using BoringTalks.Core.Updates;
using BoringTalks.Speech;

namespace BoringTalks.App.Views;

public sealed record Choice(string Name, int Value);

public sealed record LanguageChoice(string Name, string Code);

/// <summary>The settings window's view of the app: each setting reads from and writes straight to <see cref="AppModel.Settings"/>.</summary>
public sealed class SettingsViewModel : ObservableObject
{
    /// <summary>The tabs, in order; <see cref="Settings.SettingsTab"/> keeps the one last open.</summary>
    public static readonly string[] TabNames = ["transcription", "recording", "calls", "account"];

    public SettingsViewModel(AppModel app)
    {
        App = app;
        app.PropertyChanged += (_, _) => OnPropertyChanged(new PropertyChangedEventArgs(string.Empty));
        // "Restart to update" waits for the recording to end.
        app.Recorder.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(app.Recorder.Phase)) OnPropertyChanged(nameof(CanRestartToUpdate));
        };
    }

    public AppModel App { get; }
    private Settings S => App.Settings;

    public string Language { get => S.Language; set => App.UpdateSettings(s => s with { Language = value ?? "" }); }
    public bool AvoidBluetoothMic { get => S.AvoidBluetoothMic; set => App.UpdateSettings(s => s with { AvoidBluetoothMic = value }); }
    public bool UploadAudio { get => S.UploadAudio; set => App.UpdateSettings(s => s with { UploadAudio = value }); }
    public int KeepAudioDays { get => S.KeepAudioDays; set => App.UpdateSettings(s => s with { KeepAudioDays = value }); }
    public int SilenceStopMinutes { get => S.SilenceStopMinutes; set => App.UpdateSettings(s => s with { SilenceStopMinutes = value }); }
    public bool OfferToRecordCalls { get => S.OfferToRecordCalls; set => App.UpdateSettings(s => s with { OfferToRecordCalls = value }); }
    public bool StopWhenCallEnds { get => S.StopWhenCallEnds; set => App.UpdateSettings(s => s with { StopWhenCallEnds = value }); }
    public bool OpenAtSignIn { get => S.OpenAtSignIn; set => App.UpdateSettings(s => s with { OpenAtSignIn = value }); }
    public IReadOnlyList<string> IgnoredApps => S.IgnoredCallApps;
    public bool HasIgnoredApps => S.IgnoredCallApps.Count > 0;

    public int TabIndex
    {
        get => Math.Max(0, Array.IndexOf(TabNames, S.SettingsTab));
        set
        {
            if (value >= 0 && value < TabNames.Length && TabNames[value] != S.SettingsTab) App.UpdateSettings(s => s with { SettingsTab = TabNames[value] });
        }
    }

    /// <summary>Room for the title bar, the tabs and the taskbar.</summary>
    public double PageMaxHeight => Math.Max(320, SystemParameters.WorkArea.Height - 140);

    public string UpdateText => Core.Updates.UpdateText.Describe(App.UpdateState);
    public bool UpdatesAvailable => App.UpdateState is not UpdateState.Unavailable;
    public bool CanCheckForUpdates => Core.Updates.UpdateText.CanCheck(App.UpdateState);
    public bool UpdateDownloading => App.UpdateState is UpdateState.Downloading;
    public int UpdatePercent => App.UpdateState is UpdateState.Downloading d ? d.Percent : 0;
    public bool CanRestartToUpdate => App.CanRestartToUpdate;

    public bool ModelLoading => App.Models.State is ModelState.Loading;
    public bool ModelFailed => App.Models.State is ModelState.Failed;
    public double? ModelFraction => App.Models.State is ModelState.Loading { Fraction: { } f } ? f : null;
    public bool ModelIndeterminate => ModelFraction is null;

    private static readonly IReadOnlyList<LanguageChoice> AllLanguages =
    [
        new("Detect automatically", ""),
        .. ParakeetEngine.Languages
            .Select(code => new LanguageChoice(CultureInfo.GetCultureInfo(code).DisplayName, code))
            .OrderBy(l => l.Name, StringComparer.CurrentCulture),
    ];

    // Instance properties: WPF bindings don't reach static ones by path.
    public IReadOnlyList<LanguageChoice> Languages => AllLanguages;

    public IReadOnlyList<Choice> KeepChoices { get; } = [new("Delete after upload", 0), new("1 day", 1), new("7 days", 7), new("30 days", 30)];

    public IReadOnlyList<Choice> SilenceChoices =>
        [new("Never", 0), .. Settings.SilenceChoices(S.SilenceStopMinutes).Select(m => new Choice(m == 1 ? "1 minute" : $"{m} minutes", m))];

    public string DeviceName => AppModel.DeviceName;
    public string VersionText => $"{AppFlavor.Current.Name} {AppModel.Version}";
    public string WindowTitle => $"{AppFlavor.Current.Name} Settings";
    public string QuitText => $"Quit {AppFlavor.Current.Name}";
}

public partial class SettingsWindow : Window
{
    private readonly SettingsViewModel model;

    public SettingsWindow(AppModel app)
    {
        InitializeComponent();
        model = new SettingsViewModel(app);
        DataContext = model;
    }

    /// <summary>Closing only hides it; the tray app keeps one settings window.</summary>
    protected override void OnClosing(CancelEventArgs e)
    {
        e.Cancel = true;
        Hide();
    }

    private void RetryModels_Click(object sender, RoutedEventArgs e) => _ = model.App.Models.PrepareAsync();
    private void ShowRecordings_Click(object sender, RoutedEventArgs e) => AppModel.ShowInExplorer(model.App.Folders.Recordings);

    private void AskAgain_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string app }) model.App.AskAgain(app);
    }

    private void SignIn_Click(object sender, RoutedEventArgs e) => model.App.SignIn();
    private async void SignOut_Click(object sender, RoutedEventArgs e) => await model.App.SignOutAsync();
    private void Quit_Click(object sender, RoutedEventArgs e) => QuitRequested?.Invoke();
    private void CheckUpdates_Click(object sender, RoutedEventArgs e) => model.App.CheckForUpdates();
    private void RestartToUpdate_Click(object sender, RoutedEventArgs e) => model.App.RestartToUpdate();

    /// <summary>Opens on a given tab (<c>--show-settings calls</c>, for screenshots and QA).</summary>
    public void ShowTab(string name)
    {
        var index = Array.IndexOf(SettingsViewModel.TabNames, name.ToLowerInvariant());
        if (index >= 0) model.TabIndex = index;
    }

    public event Action? QuitRequested;
}
