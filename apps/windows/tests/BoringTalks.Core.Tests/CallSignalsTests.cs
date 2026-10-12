using BoringTalks.Core.Calls;

namespace BoringTalks.Core.Tests;

public sealed class CallSignalsTests
{
    private static readonly CallApp Zoom = new("Zoom", false);
    private static readonly CallApp Chrome = new("Chrome", true);

    private static CallEvent Offer(string app) => new CallEvent.Offer(app);

    [Fact]
    public void Recognizes_call_apps_by_executable_and_package()
    {
        Assert.Equal("Zoom", CallApps.Identify(@"C:\Users\me\AppData\Roaming\Zoom\bin\Zoom.exe")?.Name);
        Assert.Equal("Teams", CallApps.Identify("MSTeams_8wekyb3d8bbwe")?.Name);
        Assert.Equal("Teams", CallApps.Identify(@"C:\Program Files\WindowsApps\MSTeams_25153.1010.3727.5483_x64__8wekyb3d8bbwe\ms-teams.exe")?.Name);
        Assert.Equal(Chrome, CallApps.Identify(@"C:\Program Files\Google\Chrome\Application\chrome.exe"));
        Assert.Equal(new CallApp("Edge", true), CallApps.Identify("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"));
        Assert.Equal("Slack", CallApps.Identify("91750D7E.Slack_8she8kybcnzg4")?.Name);
        Assert.Equal("WhatsApp", CallApps.Identify("5319275A.WhatsAppDesktop_cv1g1gvanyjgm")?.Name);
        Assert.Null(CallApps.Identify(@"C:\Windows\System32\SoundRecorder.exe"));
        Assert.Null(CallApps.Identify("Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe"));
        Assert.Null(CallApps.Identify(""));
        Assert.Equal("Huddle", CallApps.Identify(@"C:\Apps\Huddle.exe", ["huddle.exe"])?.Name);
        Assert.Equal("Contoso.Huddle_abc", CallApps.Identify("Contoso.Huddle_abc", ["Contoso.Huddle_abc"])?.Name);
        Assert.Null(CallApps.Identify(@"C:\Apps\Huddle.exe", [""]));
    }

    [Fact]
    public void Offers_once_the_app_has_held_the_mic_for_a_while()
    {
        var signals = new CallSignals();
        Assert.Empty(signals.Update([Zoom], 100, false));
        Assert.Empty(signals.Update([Zoom], 104, false));
        Assert.Equal([Offer("Zoom")], signals.Update([Zoom], 105, false));
        Assert.Equal("Zoom", signals.PendingOffer);
        Assert.Empty(signals.Update([Zoom], 200, false));
    }

    [Fact]
    public void Browsers_wait_longer()
    {
        var signals = new CallSignals();
        signals.Update([Chrome], 0, false);
        Assert.Empty(signals.Update([Chrome], 10, false));
        Assert.Equal([Offer("Chrome")], signals.Update([Chrome], 15, false));
    }

    [Fact]
    public void A_short_voice_clip_is_ignored()
    {
        var signals = new CallSignals();
        signals.Update([Chrome], 0, false);
        Assert.Empty(signals.Update([], 8, false));
        Assert.Empty(signals.Update([], 30, false));
    }

    [Fact]
    public void Withdraws_when_the_call_ends_unanswered()
    {
        var signals = new CallSignals();
        signals.Update([Zoom], 0, false);
        signals.Update([Zoom], 5, false);
        Assert.Equal([new CallEvent.Withdraw("Zoom")], signals.Update([], 60, false));
        Assert.Null(signals.PendingOffer);
    }

    [Fact]
    public void Not_now_lasts_until_the_app_releases_the_mic()
    {
        var signals = new CallSignals();
        signals.Update([Zoom], 0, false);
        signals.Update([Zoom], 5, false);
        signals.DeclineOffer();
        Assert.Empty(signals.Update([Zoom], 600, false));
        // The next call asks again.
        Assert.Empty(signals.Update([], 700, false));
        signals.Update([Zoom], 800, false);
        Assert.Equal([Offer("Zoom")], signals.Update([Zoom], 805, false));
    }

    [Fact]
    public void One_question_when_a_browser_holds_the_mic_too()
    {
        var signals = new CallSignals();
        signals.Update([Zoom, Chrome], 0, false);
        Assert.Equal([Offer("Zoom")], signals.Update([Zoom, Chrome], 20, false));
        signals.DeclineOffer();
        Assert.Empty(signals.Update([Zoom, Chrome], 40, false));
    }

    [Fact]
    public void Ignored_apps_and_switched_off()
    {
        var signals = new CallSignals { Ignored = new HashSet<string> { "Zoom" } };
        signals.Update([Zoom], 0, false);
        Assert.Empty(signals.Update([Zoom], 10, false));
        var off = new CallSignals { OffersEnabled = false };
        off.Update([Zoom], 0, false);
        Assert.Empty(off.Update([Zoom], 10, false));
    }

    [Fact]
    public void No_offer_while_recording()
    {
        var signals = new CallSignals();
        signals.Update([Zoom], 0, true);
        Assert.Empty(signals.Update([Zoom], 10, true));
        Assert.Null(signals.PendingOffer);
    }

    [Fact]
    public void The_recorded_call_ends_when_its_app_releases_the_mic()
    {
        var signals = new CallSignals();
        signals.Update([Zoom], 0, false);
        signals.Update([Zoom], 5, false);
        signals.RecordingStarted(6);
        Assert.Equal("Zoom", signals.CallApp);
        Assert.Null(signals.PendingOffer);
        Assert.Empty(signals.Update([Zoom], 100, true));
        Assert.Equal([new CallEvent.Ended("Zoom")], signals.Update([], 200, true));
        Assert.Empty(signals.Update([], 202, true));
        Assert.Equal([new CallEvent.Resumed("Zoom")], signals.Update([Zoom], 210, true));
        signals.RecordingStopped();
        Assert.Null(signals.CallApp);
        Assert.Empty(signals.Update([], 300, false));
    }

    [Fact]
    public void A_stopped_recording_is_not_offered_again_during_the_same_call()
    {
        var signals = new CallSignals();
        signals.RecordingStarted(0);
        signals.Update([Zoom], 0, true);
        signals.Update([Zoom], 10, true);
        signals.RecordingStopped();
        Assert.Empty(signals.Update([Zoom], 20, false));
        signals.Update([], 30, false);
        signals.Update([Zoom], 40, false);
        Assert.Equal([Offer("Zoom")], signals.Update([Zoom], 45, false));
    }

    [Fact]
    public void A_recording_started_before_the_call_adopts_it()
    {
        var signals = new CallSignals();
        signals.RecordingStarted(0);
        Assert.Null(signals.CallApp);
        signals.Update([Chrome], 10, true);
        Assert.Null(signals.CallApp);
        signals.Update([Chrome], 25, true);
        Assert.Equal("Chrome", signals.CallApp);
        Assert.Equal([new CallEvent.Ended("Chrome")], signals.Update([], 900, true));
    }

    [Fact]
    public void Other_apps_coming_and_going_dont_end_the_call()
    {
        var signals = new CallSignals();
        signals.Update([Zoom], 0, true);
        signals.Update([Zoom], 5, true);
        Assert.Empty(signals.Update([Zoom, Chrome], 30, true));
        Assert.Empty(signals.Update([Zoom], 40, true));
    }

    [Fact]
    public void Two_processes_of_one_app_count_once()
    {
        var signals = new CallSignals();
        signals.Update([Zoom, Zoom], 0, false);
        Assert.Equal([Offer("Zoom")], signals.Update([Zoom, Zoom], 5, false));
    }
}

public sealed class CallEndWatchTests
{
    [Fact]
    public void Keeps_recording_until_the_call_ends() =>
        Assert.Equal(new CallEndVerdict.Recording(), new CallEndWatch().Verdict(0, 10_000));

    [Fact]
    public void Stops_when_the_others_stay_quiet_after_the_hang_up()
    {
        var watch = new CallEndWatch(30);
        watch.CallEnded(100);
        Assert.Equal(new CallEndVerdict.Stopping(30), watch.Verdict(90, 100));
        Assert.Equal(new CallEndVerdict.Stopping(10), watch.Verdict(90, 120));
        Assert.Equal(new CallEndVerdict.Stop(), watch.Verdict(90, 130));
    }

    [Fact]
    public void Others_still_talking_postpone_it()
    {
        // A browser that releases the mic on mute: the call goes on, the others are heard.
        var watch = new CallEndWatch(30);
        watch.CallEnded(100);
        Assert.Equal(new CallEndVerdict.Stopping(25), watch.Verdict(125, 130));
        Assert.Equal(new CallEndVerdict.Stop(), watch.Verdict(125, 155));
    }

    [Fact]
    public void Cancel_and_repeated_ends()
    {
        var watch = new CallEndWatch(30);
        watch.CallEnded(100);
        watch.CallEnded(120);
        Assert.Equal(100, watch.EndedAt);
        watch.Cancel();
        Assert.Equal(new CallEndVerdict.Recording(), watch.Verdict(0, 500));
    }
}

public sealed class MicrophoneConsentStoreTests
{
    private const string Zoom = @"C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe";
    private const string Self = @"C:#Users#me#AppData#Local#BoringTalks#current#BoringTalks.exe";

    [Fact]
    public void Lists_apps_holding_the_microphone_now()
    {
        var entries = new[]
        {
            new MicrophoneConsentStore.Entry(Zoom, false, 134_050_000_000_000_000, 0),
            new MicrophoneConsentStore.Entry("MSTeams_8wekyb3d8bbwe", true, 134_050_000_000_000_000, 0),
            // Used earlier, released since.
            new MicrophoneConsentStore.Entry(@"C:#Program Files#Google#Chrome#Application#chrome.exe", false, 134_040_000_000_000_000, 134_040_000_100_000_000),
            // Allowed, never used.
            new MicrophoneConsentStore.Entry("Microsoft.WindowsCamera_8wekyb3d8bbwe", true, 0, 0),
            // This app's own microphone while it records.
            new MicrophoneConsentStore.Entry(Self, false, 134_050_000_000_000_000, 0),
        };
        var self = @"C:\Users\me\AppData\Local\BoringTalks\current\BoringTalks.exe";
        Assert.Equal([@"C:\Users\me\AppData\Roaming\Zoom\bin\Zoom.exe", "MSTeams_8wekyb3d8bbwe"], MicrophoneConsentStore.InUse(entries, self));
        var apps = MicrophoneConsentStore.InUse(entries, self).Select(id => CallApps.Identify(id)?.Name);
        Assert.Equal(["Zoom", "Teams"], apps);
    }

    [Fact]
    public void Ignores_records_left_over_from_a_crash_or_an_old_version()
    {
        var entries = new[]
        {
            // Slack 4.26 crashed in a huddle in 2022; the record still says "in use".
            new MicrophoneConsentStore.Entry(@"C:#Users#me#AppData#Local#slack#app-4.26.1#slack.exe", false, 132_987_687_587_212_260, 0),
            // Zoom crashed today, so it isn't running.
            new MicrophoneConsentStore.Entry(Zoom, false, 134_050_000_000_000_000, 0),
            new MicrophoneConsentStore.Entry("MSTeams_8wekyb3d8bbwe", true, 134_050_000_000_000_000, 0),
        };
        var running = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { @"C:\Users\me\AppData\Local\slack\app-4.52.178\slack.exe" };
        Assert.Equal(["MSTeams_8wekyb3d8bbwe"], MicrophoneConsentStore.InUse(entries, since: 134_000_000_000_000_000, isRunning: running.Contains));
    }
}
