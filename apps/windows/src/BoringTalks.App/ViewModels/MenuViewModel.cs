using System.ComponentModel;
using System.Globalization;
using System.Windows.Media;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using BoringTalks.App.Recording;
using BoringTalks.Core;
using BoringTalks.Core.Api;
using BoringTalks.Core.Transcript;
using BoringTalks.Core.Uploads;
using BoringTalks.Speech;

namespace BoringTalks.App.ViewModels;

/// <summary>A row in "Recent meetings".</summary>
public sealed record MeetingRow(MeetingListItem Meeting, string Title, string When, string Status, Brush StatusBrush);

/// <summary>A failed upload, with its reason.</summary>
public sealed record FailedUpload(Guid Id, string Text);

/// <summary>
/// What the tray menu shows, worked out from the <see cref="AppModel"/>: the texts and states that
/// depend on several things at once, and the level bars and clocks that tick.
/// </summary>
public sealed partial class MenuViewModel : ObservableObject
{
    private static readonly Brush Green = Frozen(Color.FromRgb(0x1f, 0x9d, 0x55));
    private static readonly Brush Red = Frozen(Color.FromRgb(0xe0, 0x32, 0x3f));
    private static readonly Brush Orange = Frozen(Color.FromRgb(0xe0, 0x7a, 0x1f));
    private static readonly Brush Blue = Frozen(Color.FromRgb(0x38, 0x45, 0xdb));
    private readonly DispatcherTimer ticker;

    public MenuViewModel(AppModel app, Dispatcher ui)
    {
        App = app;
        app.PropertyChanged += (_, e) => Changed(e.PropertyName);
        app.Recorder.PropertyChanged += (_, e) => Changed(e.PropertyName);
        // Level bars and clocks.
        ticker = new DispatcherTimer(TimeSpan.FromMilliseconds(66), DispatcherPriority.Render, (_, _) => Tick(), ui);
    }

    public AppModel App { get; }
    public MeetingRecorder Recorder => App.Recorder;

    /// <summary>Ticking costs a little; only while the menu is open.</summary>
    public bool Ticking
    {
        get => ticker.IsEnabled;
        set
        {
            if (value) ticker.Start();
            else ticker.Stop();
            Tick();
        }
    }

    // ---- Header

    public static string AppName => AppFlavor.Current.Name;

    /// <summary>A new build has downloaded: offer the restart (not while recording).</summary>
    public string? UpdateBanner => App.UpdateState is Core.Updates.UpdateState.Ready ready
        ? App.CanRestartToUpdate
            ? $"{AppName} {ready.Version} is ready."
            : $"{AppName} {ready.Version} is ready. It installs after this meeting, when you restart or quit."
        : null;
    public bool CanRestartToUpdate => App.CanRestartToUpdate;
    public string HeaderCaption => App.Auth == AuthState.SignedIn ? App.Email ?? "Signed in" : "Meetings, written down for you";
    public string? DevHost => App.Config.IsProduction ? null : App.Config.ApiUrl.Host;

    // ---- Sign in

    public bool IsWaitingForBrowser => App.Auth == AuthState.WaitingForBrowser;
    public string WaitingText => App.LinkCopied ? "Link copied. Open it in the browser you use for BoringTalks…" : "Finish signing in in your browser…";

    // ---- Recording

    public string RecordButtonText => Recorder.Phase switch
    {
        RecorderPhase.Idle => "Start meeting",
        RecorderPhase.Starting => "Starting…",
        RecorderPhase.Recording => "Stop",
        _ => "Finishing transcript…",
    };

    public bool RecordButtonEnabled => Recorder.Phase is RecorderPhase.Idle or RecorderPhase.Recording;
    public bool IsIdle => Recorder.Phase == RecorderPhase.Idle;
    public string MicLabel => Recorder.MicrophoneName is { } name ? $"You · {name}" : "You";
    public string? CallOfferText => App.CallOffer is { } app && IsIdle ? $"{app} is in a call. Record it?" : null;
    public string? NeverText => App.CallOffer is { } app ? $"Never for {app}" : null;
    public string? AutoStopNotice => IsIdle ? App.AutoStopNotice : null;
    public string LiveButtonText => App.LiveWindowVisible ? "Hide live transcript" : "Show live transcript";

    public string? ModelHint => Recorder.IsRecording && Recorder.WaitingForModel
        ? "Recording. The speech model is still loading — the transcript catches up once it's ready."
        : App.Models.State is ModelState.Loading ? App.ModelSummary : null;

    /// <summary>The download failed: say so, and that it tries again (meanwhile the server transcribes).</summary>
    public string? ModelFailedText => App.Models.State is ModelState.Failed failed
        ? $"The speech model couldn't download ({failed.Message}). It tries again by itself; until then, meetings are transcribed online."
        : null;

    public double? ModelFraction => App.Models.State is ModelState.Loading { Fraction: { } f } && !(Recorder.IsRecording && Recorder.WaitingForModel) ? f : null;

    public bool ModelIndeterminate => ModelFraction is null;

    [ObservableProperty] public partial string Elapsed { get; private set; } = "";
    [ObservableProperty] public partial double MicLevel { get; private set; }
    [ObservableProperty] public partial double SystemLevel { get; private set; }
    [ObservableProperty] public partial string? CountdownText { get; private set; }

    // ---- Uploads

    public bool HasUploads => App.Uploads.Items.Count > 0;

    public string UploadSummary
    {
        get
        {
            var uploads = App.Uploads;
            var count = uploads.Waiting;
            var noun = count == 1 ? "upload" : "uploads";
            if (uploads.NeedsSignIn) return $"{count} {noun} waiting — sign in again";
            if (!uploads.IsOnline) return $"{count} {noun} waiting — offline";
            if (uploads.ActiveId is not null) return $"Uploading… ({count} waiting)";
            if (uploads.Failed > 0 && count == 0) return $"{uploads.Failed} upload{(uploads.Failed == 1 ? "" : "s")} failed";
            return $"{count} {noun} waiting — will retry";
        }
    }

    public bool ShowRetry => App.Uploads is var u && (u.Failed > 0 || !u.IsOnline || u.Items.Any(i => i.NextAttemptAt is not null));

    public IReadOnlyList<FailedUpload> FailedUploads =>
        [.. App.Uploads.Items.Where(i => i.IsFailed).Select(i => new FailedUpload(i.Id, $"{i.Title ?? "Meeting"} — {i.LastError ?? "failed"}"))];

    // ---- Recent meetings

    public IReadOnlyList<MeetingRow> Meetings => [.. App.RecentMeetings.Select(m => new MeetingRow(m, m.Title,
        m.StartedAt.ToLocalTime().ToString("MMM d, h:mm tt", CultureInfo.CurrentCulture), m.Status.Title(),
        m.Status switch { MeetingStatus.Ready => Green, MeetingStatus.Failed => Red, MeetingStatus.Recording => Orange, _ => Blue }))];

    public bool NoMeetings => App.RecentMeetings.Count == 0 && App.MeetingsError is null;

    // ---- Plumbing

    private void Changed(string? property)
    {
        // Most texts depend on several model properties; recomputing them all is cheap.
        OnPropertyChanged(new PropertyChangedEventArgs(string.Empty));
        if (property is nameof(MeetingRecorder.Phase) or nameof(MeetingRecorder.PendingStop)) Tick();
    }

    private void Tick()
    {
        var started = Recorder.StartedAt;
        if (Recorder.IsRecording && started is { } s)
        {
            var seconds = (int)Math.Max(0, (DateTimeOffset.Now - s).TotalSeconds);
            Elapsed = seconds >= 3600 ? $"{seconds / 3600}:{seconds / 60 % 60:00}:{seconds % 60:00}" : $"{seconds / 60}:{seconds % 60:00}";
            MicLevel = Recorder.Meter(AudioChannel.Microphone).Read().Level;
            SystemLevel = Recorder.Meter(AudioChannel.System).Read().Level;
        }
        else
        {
            Elapsed = "";
            MicLevel = 0;
            SystemLevel = 0;
        }
        if (Recorder.IsRecording && Recorder.PendingStop is { } pending)
        {
            var left = (int)Math.Ceiling(Math.Max(0, (pending.At - DateTimeOffset.Now).TotalSeconds));
            var why = pending.Reason is AutoStopReason.CallEnded c ? $"The {c.App} call ended." : "Nobody has spoken for a while.";
            CountdownText = $"{why} Stopping in {left / 60}:{left % 60:00}.";
        }
        else
        {
            CountdownText = null;
        }
    }

    private static Brush Frozen(Color color)
    {
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        return brush;
    }
}
