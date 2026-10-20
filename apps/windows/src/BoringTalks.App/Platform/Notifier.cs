using Microsoft.Toolkit.Uwp.Notifications;
using BoringTalks.Core;

namespace BoringTalks.App.Platform;

/// <summary>
/// Windows notifications for things that happen while the menu is closed: a call that started
/// (Record it?), a quiet meeting about to stop (Keep recording), and a meeting that stopped by
/// itself. With notifications turned off for BoringTalks the menu still shows all of it.
/// </summary>
public sealed class Notifier : IDisposable
{
    private const string Group = "boringtalks";
    private const string CallTag = "call-offer";
    private const string WarningTag = "silence-warning";
    private const string StoppedTag = "stopped";
    private const string GameTag = "game";

    public Notifier()
    {
        ToastNotificationManagerCompat.OnActivated += OnActivated;
    }

    /// <summary>The warning's "Keep recording" button.</summary>
    public event Action? KeepRecording;
    /// <summary>The call offer was answered: Record (also a click on the notification).</summary>
    public event Action? RecordCall;
    /// <summary>…Not now.</summary>
    public event Action? DeclineCall;
    /// <summary>…Never ask for this app (its name).</summary>
    public event Action<string>? IgnoreCallApp;
    /// <summary>"Stop" on the game-session notification.</summary>
    public event Action? StopRecording;
    /// <summary>A click on any other notification: show the menu.</summary>
    public event Action? Opened;

    public void OfferToRecord(string app) => Show(CallTag, b => b
        .AddArgument("action", "offer").AddArgument("app", app)
        .AddText($"{app} is in a call. Record it?")
        .AddText("BoringTalks can write this meeting down. Choose Record to start.")
        .AddButton(new ToastButton().SetContent("Record").AddArgument("action", "record"))
        .AddButton(new ToastButton().SetContent("Not now").AddArgument("action", "not-now"))
        .AddButton(new ToastButton().SetContent($"Never for {app}").AddArgument("action", "never").AddArgument("app", app))
        .SetToastScenario(ToastScenario.Reminder));

    public void WithdrawOffer() => Remove(CallTag);

    public void RecordingGame(string game) => Show(GameTag, b => b
        .AddArgument("action", "open")
        .AddText($"Recording your {game} session")
        .AddText("BoringTalks writes down the voice chat and stops when you close the game.")
        .AddButton(new ToastButton().SetContent("Stop").AddArgument("action", "stop")));

    public void ClearGame() => Remove(GameTag);

    public void WarnSilence(double stopsIn) => Show(WarningTag, b => b
        .AddArgument("action", "warning")
        .AddText("Still in a meeting?")
        .AddText($"Nobody has spoken for a while. BoringTalks stops recording in {(int)Math.Round(stopsIn)} seconds unless you keep it going.")
        .AddButton(new ToastButton().SetContent("Keep recording").AddArgument("action", "keep")));

    /// <summary>The recording limit is near. Nothing keeps it going, so no button.</summary>
    public void WarnLimit(double stopsIn, double limitSeconds) => Show(WarningTag, b => b
        .AddArgument("action", "open")
        .AddText($"Recording stops in {Math.Max(1, (int)Math.Round(stopsIn / 60))} min")
        .AddText($"Recordings are limited to {RecordingLimit.Describe(limitSeconds)}. What was recorded is saved and uploaded as usual."));

    public void ClearWarning() => Remove(WarningTag);

    public void RecordingStopped(string message)
    {
        ClearWarning();
        Show(StoppedTag, b => b.AddArgument("action", "open").AddText("Recording stopped").AddText(message));
    }

    private static void Show(string tag, Func<ToastContentBuilder, ToastContentBuilder> build)
    {
        try
        {
            build(new ToastContentBuilder()).Show(toast =>
            {
                toast.Tag = tag;
                toast.Group = Group;
            });
        }
        catch (Exception error) when (error is System.Runtime.InteropServices.COMException or InvalidOperationException or UnauthorizedAccessException)
        {
            Log.Error("notifications", "couldn't show a notification", error);
        }
    }

    private static void Remove(string tag)
    {
        try
        {
            ToastNotificationManagerCompat.History.Remove(tag, Group);
        }
        catch (Exception error) when (error is System.Runtime.InteropServices.COMException or InvalidOperationException)
        {
        }
    }

    private void OnActivated(ToastNotificationActivatedEventArgsCompat e)
    {
        var arguments = ToastArguments.Parse(e.Argument);
        arguments.TryGetValue("action", out var action);
        arguments.TryGetValue("app", out var app);
        switch (action)
        {
            case "keep": KeepRecording?.Invoke(); break;
            case "stop": StopRecording?.Invoke(); break;
            case "record" or "offer": RecordCall?.Invoke(); break;
            case "not-now": DeclineCall?.Invoke(); break;
            case "never" when app is not null: IgnoreCallApp?.Invoke(app); break;
            default: Opened?.Invoke(); break;
        }
    }

    public void Dispose()
    {
        ToastNotificationManagerCompat.OnActivated -= OnActivated;
    }

    /// <summary>On uninstall: remove the notifications and their registration.</summary>
    public static void Uninstall()
    {
        try
        {
            ToastNotificationManagerCompat.Uninstall();
        }
        catch (Exception error) when (error is System.Runtime.InteropServices.COMException or InvalidOperationException)
        {
        }
    }
}
