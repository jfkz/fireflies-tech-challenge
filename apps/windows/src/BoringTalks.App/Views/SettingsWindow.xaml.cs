using System.ComponentModel;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using CommunityToolkit.Mvvm.ComponentModel;
using BoringTalks.App.ViewModels;
using BoringTalks.Core;
using BoringTalks.Core.Updates;
using BoringTalks.Speech;

namespace BoringTalks.App.Views;

public sealed record Choice(string Name, int Value);

public sealed record LanguageChoice(string Name, string Code);

public sealed record MicrophoneChoice(string Name, string Id);

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
        app.Devices.Changed += _ => System.Windows.Application.Current?.Dispatcher.BeginInvoke(RefreshMicrophones);
        BuildMicrophones();
        app.Recorder.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(app.Recorder.Phase)) OnPropertyChanged(nameof(CanRestartToUpdate));
        };
    }

    public AppModel App { get; }
    private Settings S => App.Settings;

    public string Language { get => S.Language; set => App.UpdateSettings(s => s with { Language = value ?? "" }); }
    public bool TranscribeOnPc { get => S.TranscribeOnPc; set => App.UpdateSettings(s => s with { TranscribeOnPc = value }); }
    public bool UploadOnly { get => !S.TranscribeOnPc; set => TranscribeOnPc = !value; }
    public string TranscribeHelp => S.TranscribeOnPc
        ? "Parakeet v3 writes the transcript on this PC as you talk, for free. Only the text (and the audio, if you upload it) leaves the PC."
        : "Nothing is transcribed here: BoringTalks records you and the others on separate channels and uploads the audio, and the server transcribes it once the meeting is over, keeping “You” apart from the others. No live transcript, no speech model to download.";
    public string ModelStatus => S.TranscribeOnPc ? App.ModelSummary : "Not needed while the server transcribes";
    public string UploadAudioHelp => S.TranscribeOnPc
        ? "Lets the dashboard play the meeting back. Without a local transcript the audio is uploaded anyway, so the server can transcribe it."
        : "Always on while the server transcribes: it needs the audio.";
    public bool AvoidBluetoothMic { get => S.AvoidBluetoothMic; set => App.UpdateSettings(s => s with { AvoidBluetoothMic = value }); }
    public bool UploadAudio { get => S.UploadAudio || !S.TranscribeOnPc; set => App.UpdateSettings(s => s with { UploadAudio = value }); }
    public int KeepAudioDays { get => S.KeepAudioDays; set => App.UpdateSettings(s => s with { KeepAudioDays = value }); }
    public int SilenceStopMinutes { get => S.SilenceStopMinutes; set => App.UpdateSettings(s => s with { SilenceStopMinutes = value }); }
    public bool OfferToRecordCalls { get => S.OfferToRecordCalls; set => App.UpdateSettings(s => s with { OfferToRecordCalls = value }); }
    public bool RecordGames { get => S.RecordGames; set => App.UpdateSettings(s => s with { RecordGames = value }); }
    public bool StopWhenCallEnds { get => S.StopWhenCallEnds; set => App.UpdateSettings(s => s with { StopWhenCallEnds = value }); }
    public bool OpenAtSignIn { get => S.OpenAtSignIn; set => App.UpdateSettings(s => s with { OpenAtSignIn = value }); }
    public bool PlaySounds { get => S.PlaySounds; set => App.UpdateSettings(s => s with { PlaySounds = value }); }
    public string HotkeyText => S.RecordHotkey.Length > 0 ? S.RecordHotkey : "None";
    public void SetHotkey(string value) => App.UpdateSettings(s => s with { RecordHotkey = value });
    public string LimitText => S.RecordingLimitMinutes > 0
        ? $"Recordings stop at {RecordingLimit.Describe(S.RecordingLimitMinutes * 60)}, set for your account; BoringTalks warns 5 minutes before."
        : "Your account has no recording limit.";
    public IReadOnlyList<string> IgnoredApps => S.IgnoredCallApps;

    private IReadOnlyList<MicChoice.Device> connected = [];

    /// <summary>System default, every microphone connected now, and the picked one if it's unplugged. One list per refresh, so the box keeps its selection.</summary>
    public IReadOnlyList<MicrophoneChoice> Microphones { get; private set; } = [];

    public string MicrophoneId
    {
        get => S.MicrophoneId;
        set
        {
            // A list being swapped sets null for a moment; that isn't a choice.
            if (value is null || value == S.MicrophoneId) return;
            var name = connected.FirstOrDefault(d => d.Id == value)?.Name ?? "";
            App.UpdateSettings(s => s with { MicrophoneId = value, MicrophoneName = name });
            BuildMicrophones();
        }
    }

    /// <summary>Lists the microphones again (off the UI thread: it can take a second or two).</summary>
    public async void RefreshMicrophones()
    {
        try
        {
            connected = await Task.Run(Audio.AudioDevices.ListMicrophones);
        }
        catch (Exception error) when (error is System.Runtime.InteropServices.COMException or InvalidOperationException)
        {
            Platform.Log.Error("settings", "couldn't list the microphones", error);
            return;
        }
        BuildMicrophones();
    }

    private void BuildMicrophones()
    {
        List<MicrophoneChoice> list = [new("System default", ""), .. connected.Select(d => new MicrophoneChoice(d.Name, d.Id))];
        if (S.MicrophoneId.Length > 0 && connected.All(d => d.Id != S.MicrophoneId))
        {
            list.Add(new($"{(S.MicrophoneName.Length > 0 ? S.MicrophoneName : "The microphone you picked")} (not connected: using the system default)", S.MicrophoneId));
        }
        Microphones = list;
        OnPropertyChanged(nameof(Microphones));
        OnPropertyChanged(nameof(MicrophoneId));
    }
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

    public bool ModelLoading => S.TranscribeOnPc && App.Models.State is ModelState.Loading;
    public bool ModelFailed => S.TranscribeOnPc && App.Models.State is ModelState.Failed;
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

    /// <summary>Microphones come and go; list them again whenever the window shows.</summary>
    protected override void OnActivated(EventArgs e)
    {
        base.OnActivated(e);
        model.RefreshMicrophones();
    }

    private void RetryModels_Click(object sender, RoutedEventArgs e) => _ = model.App.Models.PrepareAsync();
    private void ShowRecordings_Click(object sender, RoutedEventArgs e) => AppModel.ShowInExplorer(model.App.Folders.Recordings);

    private void AskAgain_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string app }) model.App.AskAgain(app);
    }

    // ---- The start/stop shortcut box: press the keys to set it.

    private void HotkeyBox_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        e.Handled = true;
        var key = e.Key == Key.System ? e.SystemKey : e.Key;
        if (key is Key.LeftCtrl or Key.RightCtrl or Key.LeftAlt or Key.RightAlt or Key.LeftShift or Key.RightShift or Key.LWin or Key.RWin) return;
        if (key is Key.Escape or Key.Tab)
        {
            Keyboard.ClearFocus();
            return;
        }
        var modifiers = HotkeyModifiers.None;
        if (Keyboard.Modifiers.HasFlag(ModifierKeys.Control)) modifiers |= HotkeyModifiers.Control;
        if (Keyboard.Modifiers.HasFlag(ModifierKeys.Alt)) modifiers |= HotkeyModifiers.Alt;
        if (Keyboard.Modifiers.HasFlag(ModifierKeys.Shift)) modifiers |= HotkeyModifiers.Shift;
        if (Keyboard.Modifiers.HasFlag(ModifierKeys.Windows)) modifiers |= HotkeyModifiers.Win;
        if (Hotkey.Create(modifiers, key.ToString()) is { } hotkey) model.SetHotkey(hotkey.ToString());
    }

    // While the box has the keyboard, the shortcut being changed mustn't start a recording.
    private void HotkeyBox_GotFocus(object sender, KeyboardFocusChangedEventArgs e) => model.App.SuspendHotkey(true);
    private void HotkeyBox_LostFocus(object sender, KeyboardFocusChangedEventArgs e) => model.App.SuspendHotkey(false);
    private void ClearHotkey_Click(object sender, RoutedEventArgs e) => model.SetHotkey("");
    private void DefaultHotkey_Click(object sender, RoutedEventArgs e) => model.SetHotkey(Hotkey.Default);

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
