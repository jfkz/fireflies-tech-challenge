using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Reflection;
using System.Windows;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using BoringTalks.App.Audio;
using BoringTalks.App.Platform;
using BoringTalks.App.Recording;
using BoringTalks.Core;
using BoringTalks.Core.Api;
using BoringTalks.Core.Auth;
using BoringTalks.Core.Calls;
using BoringTalks.Core.Uploads;
using BoringTalks.Speech;

namespace BoringTalks.App.ViewModels;

public enum AuthState
{
    Unknown,
    SignedOut,
    /// <summary>The browser is open on the connect page; waiting for the callback.</summary>
    WaitingForBrowser,
    SignedIn,
}

/// <summary>
/// The app's state for the menu, the settings and the live window: who is signed in, the recorder,
/// the upload queue and the latest meetings. Lives on the UI thread.
/// </summary>
public sealed partial class AppModel : ObservableObject, IAsyncDisposable
{
    private readonly Dispatcher ui;
    private readonly JsonSettingsStore settingsStore;
    private readonly HttpClient http = new();
    private readonly ApiClient api;
    private readonly DeviceAuthenticator authenticator;
    private readonly MicUsageMonitor micMonitor = new();
    private readonly CallSignals callSignals = new();
    private readonly DispatcherTimer callTimer;
    private readonly DispatcherTimer refreshTimer;
    private readonly Action<string> log = Log.For("app");

    public AppModel(AppConfig config, AppFolders folders, JsonSettingsStore settingsStore, Dispatcher ui)
    {
        Config = config;
        Folders = folders;
        this.settingsStore = settingsStore;
        this.ui = ui;
        Settings = settingsStore.Load();
        Devices = new AudioDevices();
        Models = new SpeechModels(new ModelStore(folders.Models, http, Log.For("models")), Log.For("models"));
        Models.Changed += _ => ui.BeginInvoke(() => OnPropertyChanged(nameof(ModelSummary)));
        Recorder = new MeetingRecorder(Models, folders, Devices, ui, Log.For("recorder"));
        Recorder.SilenceWarning += left =>
        {
            if (left is { } seconds) Notifier.WarnSilence(seconds);
            else Notifier.ClearWarning();
        };
        Recorder.AutoStop += reason => _ = StopByItselfAsync(reason);

        // The token is read through the authenticator, which caches it.
        api = new ApiClient(config.ApiUrl, http, _ => ValueTask.FromResult(authenticator?.Token()), $"BoringTalks-Windows/{Version}");
        authenticator = new DeviceAuthenticator(api, new CredentialStore(), $"device-token.{config.ApiUrl.Host}");
        Queue = new UploadQueue(api, new FileUploadStore(folders.UploadQueue), folders.Recordings, Settings.KeepAudioDays, log: Log.For("uploads"));
        Queue.Changed += snapshot => ui.BeginInvoke(() => Receive(snapshot));

        Notifier.KeepRecording += () => ui.BeginInvoke(KeepRecording);
        Notifier.RecordCall += () => ui.BeginInvoke(RecordCall);
        Notifier.DeclineCall += () => ui.BeginInvoke(DeclineCall);
        Notifier.IgnoreCallApp += app => ui.BeginInvoke(() => IgnoreCallApp(app));
        Notifier.Opened += () => ui.BeginInvoke(() => ShowMenuRequested?.Invoke());

        callTimer = new DispatcherTimer(TimeSpan.FromSeconds(2), DispatcherPriority.Background, (_, _) => EvaluateCalls(), ui);
        refreshTimer = new DispatcherTimer(TimeSpan.FromSeconds(20), DispatcherPriority.Background, (_, _) =>
        {
            // While a meeting is being summarized, its status changes within a minute or so.
            if (RecentMeetings.Any(m => m.Status.IsProcessing())) RefreshMeetings();
        }, ui);
    }

    public AppConfig Config { get; }
    public AppFolders Folders { get; }
    public AudioDevices Devices { get; }
    public SpeechModels Models { get; }
    public MeetingRecorder Recorder { get; }
    public UploadQueue Queue { get; }
    public Notifier Notifier { get; } = new();

    [ObservableProperty] public partial Settings Settings { get; private set; }
    [ObservableProperty] public partial AuthState Auth { get; private set; } = AuthState.Unknown;
    [ObservableProperty] public partial string? Email { get; private set; }
    [ObservableProperty] public partial string? AuthError { get; private set; }
    /// <summary>The sign-in link was copied rather than opened.</summary>
    [ObservableProperty] public partial bool LinkCopied { get; private set; }
    [ObservableProperty] public partial IReadOnlyList<MeetingListItem> RecentMeetings { get; private set; } = [];
    [ObservableProperty] public partial string? MeetingsError { get; private set; }
    [ObservableProperty] public partial UploadSnapshot Uploads { get; private set; } = new();
    [ObservableProperty] public partial string? RecordError { get; private set; }
    /// <summary>Why the last meeting stopped by itself (the call ended, nobody spoke), until dismissed.</summary>
    [ObservableProperty] public partial string? AutoStopNotice { get; private set; }
    /// <summary>A call app has been using the microphone: the name of the app we're asking about.</summary>
    [ObservableProperty] public partial string? CallOffer { get; private set; }
    /// <summary>The live transcript window is showing.</summary>
    [ObservableProperty] public partial bool LiveWindowVisible { get; set; }
    /// <summary>Optional title for the next meeting.</summary>
    [ObservableProperty] public partial string TitleDraft { get; set; } = "";

    public string ModelSummary => Models.Summary;

    /// <summary>The menu should open (a notification was clicked, the app was launched again).</summary>
    public event Action? ShowMenuRequested;

    public static string Version => Assembly.GetEntryAssembly()?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "dev";

    public static string DeviceName => Environment.MachineName;

    // ---- Launch

    public void Launch()
    {
        try
        {
            Folders.Create();
        }
        catch (IOException error)
        {
            Log.Error("app", "couldn't create the app folders", error);
        }
        Queue.Load();
        if (authenticator.Credential() is { } credential)
        {
            SetSignedIn(credential.Email);
            Queue.Start();
            RefreshMeetings();
        }
        else
        {
            Auth = AuthState.SignedOut;
        }
        PruneRecordings();
        Queue.SetOnline(NetworkInterface.GetIsNetworkAvailable());
        NetworkChange.NetworkAvailabilityChanged += (_, e) => Queue.SetOnline(e.IsAvailable);
        NetworkChange.NetworkAddressChanged += (_, _) => Queue.SetOnline(NetworkInterface.GetIsNetworkAvailable());
        // Start downloading the speech model right away; it takes a while the first time.
        _ = Models.PrepareAsync();
        refreshTimer.Start();
        micMonitor.Changed += () => ui.BeginInvoke(EvaluateCalls);
        micMonitor.Start();
        callTimer.Start();
    }

    private void Receive(UploadSnapshot snapshot)
    {
        var finishedOne = snapshot.UploadedCount != Uploads.UploadedCount;
        Uploads = snapshot;
        if (snapshot.NeedsSignIn && Auth == AuthState.SignedIn) SignedOutByServer();
        if (finishedOne)
        {
            RefreshMeetings();
            PruneRecordings();
        }
    }

    private void SetSignedIn(string? email)
    {
        Email = email;
        Auth = AuthState.SignedIn;
    }

    // ---- Sign in

    public void SignIn()
    {
        AuthError = null;
        LinkCopied = false;
        var url = authenticator.Begin(Config.WebUrl, DeviceName);
        Auth = AuthState.WaitingForBrowser;
#if DEBUG
        // QA against a mock API: print the connect URL instead of opening a browser.
        if (Environment.GetCommandLineArgs().Contains("--debug-print-connect-url"))
        {
            log($"CONNECT_URL {url}");
            return;
        }
#endif
        Open(url);
    }

    /// <summary>For when the default browser isn't the one the user is signed in to: puts the link on the clipboard instead.</summary>
    public void CopySignInLink()
    {
        AuthError = null;
        var url = authenticator.Begin(Config.WebUrl, DeviceName);
        Auth = AuthState.WaitingForBrowser;
        try
        {
            Clipboard.SetText(url.ToString());
            LinkCopied = true;
        }
        catch (System.Runtime.InteropServices.COMException)
        {
            AuthError = "Couldn't copy the link; try again.";
        }
    }

    public void CancelSignIn()
    {
        LinkCopied = false;
        if (Auth == AuthState.WaitingForBrowser) Auth = AuthState.SignedOut;
    }

    /// <summary><c>boringtalks://callback?code=…</c></summary>
    public void HandleLink(string link)
    {
        try
        {
            _ = CompleteAsync(DeviceLink.CodeFromCallback(link));
        }
        catch (CallbackException error)
        {
            AuthError = error.Message;
            if (Auth == AuthState.WaitingForBrowser) Auth = AuthState.SignedOut;
        }
    }

    /// <summary>The "Paste code" field: the code or the whole callback link.</summary>
    public void SubmitPasted(string text)
    {
        if (DeviceLink.CodeFromPasted(text) is { } code) _ = CompleteAsync(code);
        else AuthError = "That doesn't look like a sign-in code.";
    }

    private async Task CompleteAsync(string code)
    {
        AuthError = null;
        try
        {
            var credential = await authenticator.CompleteAsync(code);
            SetSignedIn(credential.Email);
            log($"signed in as device {credential.DeviceId}");
            Queue.Resume();
            Queue.Start();
            RefreshMeetings();
            ShowMenuRequested?.Invoke();
        }
        catch (Exception error) when (error is ApiException or NoSignInInProgressException or IOException)
        {
            AuthError = error.Message;
            Auth = AuthState.SignedOut;
        }
    }

    public async Task SignOutAsync()
    {
        authenticator.SignOut();
        await Queue.StopAsync();
        Auth = AuthState.SignedOut;
        Email = null;
        RecentMeetings = [];
    }

    private void SignedOutByServer()
    {
        authenticator.SignOut();
        Auth = AuthState.SignedOut;
        Email = null;
        AuthError = "This PC was signed out (it was disconnected in Settings, or its sign-in expired). Sign in again — waiting uploads will continue.";
        RecentMeetings = [];
    }

    // ---- Recording

    public async Task StartMeetingAsync()
    {
        RecordError = null;
        AutoStopNotice = null;
        try
        {
            Recorder.AvoidBluetoothMic = Settings.AvoidBluetoothMic;
            Recorder.SilenceLimit = Settings.SilenceStopMinutes * 60;
            await Recorder.StartAsync(TitleDraft, Settings.LanguageCode, Settings.UploadAudio);
            callSignals.RecordingStarted(Now);
            ClearCallOffer();
        }
        catch (Exception error)
        {
            // Whatever it was, the menu says so and the log has the details.
            Log.Error("recorder", "couldn't start the meeting", error);
            RecordError = error is CaptureException or IOException or UnauthorizedAccessException ? error.Message : $"Couldn't start recording: {error.Message}";
        }
    }

    public async Task StopMeetingAsync()
    {
        Notifier.ClearWarning();
        var meeting = await Recorder.StopAsync();
        callSignals.RecordingStopped();
        if (meeting is null)
        {
            RecordError = "Nothing was recorded.";
            return;
        }
        TitleDraft = "";
        Queue.Enqueue(meeting);
    }

    /// <summary>The call ended or nobody spoke for a while: the meeting is over but the recording was left on.</summary>
    private async Task StopByItselfAsync(AutoStopReason reason)
    {
        var why = reason switch
        {
            AutoStopReason.Silence s => $"Nobody spoke for {SilenceWatch.Describe(s.Limit)}",
            AutoStopReason.CallEnded c => $"The {c.App} call ended",
            _ => "The meeting ended",
        };
        var meeting = await Recorder.StopAsync();
        callSignals.RecordingStopped();
        string message;
        if (meeting is not null)
        {
            TitleDraft = "";
            Queue.Enqueue(meeting);
            message = $"{why}, so BoringTalks stopped recording. {(meeting.Title is { } t ? $"“{t}”" : "The meeting")} is uploading as usual.";
        }
        else
        {
            message = $"{why}, so BoringTalks stopped recording. Nothing was recorded.";
        }
        AutoStopNotice = message;
        Notifier.RecordingStopped(message);
    }

    /// <summary>The "Keep recording" button (in the menu or on the warning notification).</summary>
    public void KeepRecording()
    {
        Recorder.KeepRecording();
        Notifier.ClearWarning();
    }

    public void DismissAutoStopNotice() => AutoStopNotice = null;

    /// <summary>Quitting while recording: keep what was captured so far (the audio is on disk; the transcript gets a few seconds).</summary>
    public async Task SaveRecordingOnQuitAsync()
    {
        if (!Recorder.IsRecording) return;
        var stop = Recorder.StopAsync();
        if (await Task.WhenAny(stop, Task.Delay(TimeSpan.FromSeconds(8))) == stop && await stop is { } meeting) Queue.Enqueue(meeting);
    }

    // ---- Calls

    private static double Now => Stopwatch.GetTimestamp() / (double)Stopwatch.Frequency;

    /// <summary>Which apps use the microphone: offers to record a call, and tells the recorder when the recorded call's app hangs up.</summary>
    private void EvaluateCalls()
    {
        var active = micMonitor.Users.Select(id => CallApps.Identify(id, Settings.ExtraCallApps)).OfType<CallApp>().ToList();
        callSignals.OffersEnabled = Settings.OfferToRecordCalls && Auth == AuthState.SignedIn;
        callSignals.Ignored = Settings.IgnoredCallApps.ToHashSet();
        foreach (var e in callSignals.Update(active, Now, Recorder.Phase != RecorderPhase.Idle))
        {
            switch (e)
            {
                case CallEvent.Offer offer:
                    log($"{offer.App} is in a call; offering to record");
                    CallOffer = offer.App;
                    Notifier.OfferToRecord(offer.App);
                    break;
                case CallEvent.Withdraw:
                    ClearCallOffer();
                    break;
                case CallEvent.Ended ended:
                    if (Settings.StopWhenCallEnds) Recorder.CallEnded(ended.App);
                    break;
                case CallEvent.Resumed:
                    Recorder.CallResumed();
                    break;
            }
        }
    }

    /// <summary>Record (from the menu or the notification).</summary>
    public void RecordCall()
    {
        ClearCallOffer();
        if (Recorder.Phase == RecorderPhase.Idle) _ = StartMeetingAsync();
    }

    /// <summary>Not now: asked again for the next call.</summary>
    public void DeclineCall()
    {
        callSignals.DeclineOffer();
        ClearCallOffer();
    }

    public void IgnoreCallApp(string app)
    {
        if (!Settings.IgnoredCallApps.Contains(app)) UpdateSettings(s => s with { IgnoredCallApps = [.. s.IgnoredCallApps, app] });
        DeclineCall();
    }

    public void AskAgain(string app) => UpdateSettings(s => s with { IgnoredCallApps = [.. s.IgnoredCallApps.Where(a => a != app)] });

    private void ClearCallOffer()
    {
        CallOffer = null;
        Notifier.WithdrawOffer();
    }

    // ---- Meetings

    public async void RefreshMeetings()
    {
        if (Auth != AuthState.SignedIn) return;
        try
        {
            RecentMeetings = (await api.ListMeetingsAsync(5)).Items;
            MeetingsError = null;
        }
        catch (ApiException error) when (error.Kind == ApiErrorKind.Unauthorized)
        {
            SignedOutByServer();
        }
        catch (ApiException error)
        {
            MeetingsError = error.Message;
        }
    }

    public void OpenMeeting(MeetingListItem meeting) => Open(Config.MeetingUrl(meeting.Id));

    public void OpenDashboard() => Open(Config.DashboardUrl);

    public void RetryUploads()
    {
        foreach (var item in Uploads.Items) Queue.Retry(item.Id);
    }

    public void DiscardUpload(Guid id) => Queue.Discard(id);

    // ---- Settings

    public void UpdateSettings(Func<Settings, Settings> change)
    {
        var old = Settings;
        Settings = change(Settings);
        try
        {
            settingsStore.Save(Settings);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            Log.Error("app", "couldn't save the settings", error);
        }
        if (old.KeepAudioDays != Settings.KeepAudioDays)
        {
            Queue.SetKeepAudioDays(Settings.KeepAudioDays);
            PruneRecordings();
        }
        if (old.OpenAtSignIn != Settings.OpenAtSignIn) TryRegister(() => Registration.SetOpenAtSignIn(Settings.OpenAtSignIn));
    }

    public static void TryRegister(Action register)
    {
        try
        {
            register();
        }
        catch (Exception error) when (error is UnauthorizedAccessException or System.Security.SecurityException or IOException)
        {
            Log.Error("app", "couldn't update the registry", error);
        }
    }

    private void PruneRecordings()
    {
        var protectedFiles = new HashSet<string>(Queue.ProtectedFiles, StringComparer.OrdinalIgnoreCase);
        if (Recorder.CurrentFileName is { } current) protectedFiles.Add(current);
        var keep = Settings.KeepAudioDays;
        _ = Task.Run(() =>
        {
            var deleted = RecordingJanitor.Prune(Folders.Recordings, keep, protectedFiles);
            if (deleted.Count > 0) log($"deleted {deleted.Count} old recordings");
        });
    }

    public void ToggleLiveWindow() => LiveWindowVisible = !LiveWindowVisible;

    public static void Open(Uri url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url.ToString()) { UseShellExecute = true })?.Dispose();
        }
        catch (System.ComponentModel.Win32Exception error)
        {
            Log.Error("app", $"couldn't open {url}", error);
        }
    }

    public static void ShowInExplorer(string folder)
    {
        Directory.CreateDirectory(folder);
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{folder}\"") { UseShellExecute = true })?.Dispose();
    }

    public async ValueTask DisposeAsync()
    {
        callTimer.Stop();
        refreshTimer.Stop();
        micMonitor.Dispose();
        await Queue.DisposeAsync();
        Notifier.Dispose();
        Models.Dispose();
        Devices.Dispose();
        authenticator.Dispose();
        http.Dispose();
    }
}
