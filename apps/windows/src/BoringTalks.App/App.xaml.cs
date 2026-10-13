using System.ComponentModel;
using System.Windows;
using BoringTalks.App.Platform;
using BoringTalks.App.ViewModels;
using BoringTalks.App.Views;
using BoringTalks.Core;
using BoringTalks.Core.Auth;

namespace BoringTalks.App;

/// <summary>
/// The tray app: the model, the tray icon, the menu, the settings and live transcript windows, and
/// the links and launches handed over by later starts of BoringTalks.
/// </summary>
public partial class App : Application
{
    private readonly string[] arguments;
    private readonly SingleInstance instance;
    private AppModel? model;
    private TrayIcon? tray;
    private MenuWindow? menu;
    private SettingsWindow? settings;
    private LiveTranscriptWindow? live;
    private bool quitting;

    public App(string[] arguments, SingleInstance instance)
    {
        this.arguments = arguments;
        this.instance = instance;
        DispatcherUnhandledException += (_, e) =>
        {
            Log.Error("app", "unexpected error", e.Exception);
            e.Handled = true;
        };
    }

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var folders = AppFolders.Standard;
        var store = new JsonSettingsStore(folders.Settings);
        var stored = store.Load();
        var config = AppConfig.Resolve(arguments, stored.ApiUrl, stored.WebUrl);
        model = new AppModel(config, folders, store, Dispatcher);
        var menuModel = new MenuViewModel(model, Dispatcher);
        menu = new MenuWindow(menuModel);
        menu.SettingsRequested += ShowSettings;
        menu.QuitRequested += Quit;
        tray = new TrayIcon(model, menu.Toggle, ShowSettings, Quit);
        live = new LiveTranscriptWindow(model);
        model.PropertyChanged += OnModelChanged;
        model.ShowMenuRequested += () => menu.ShowMenu();

        AppModel.TryRegister(Registration.RegisterProtocol);
        AppModel.TryRegister(() => Registration.SetOpenAtSignIn(model.Settings.OpenAtSignIn));
        model.Launch();

        // Later launches (a sign-in link from the browser, the Start menu) arrive here.
        instance.Listen(forwarded => Dispatcher.BeginInvoke(() => Handle(forwarded, launched: false)));
        Handle(arguments, launched: true);
    }

    private void Handle(string[] args, bool launched)
    {
        if (model is null || menu is null) return;
        if (args.FirstOrDefault(a => DeviceLink.IsCallback(a)) is { } link)
        {
            model.HandleLink(link);
            return;
        }
        if (args.Contains("--demo"))
        {
            // Sample phrases in the live transcript window.
            model.Recorder.Live.ShowDemo();
            model.LiveWindowVisible = true;
        }
#if DEBUG
        if (args.Contains("--debug-sign-in")) model.SignIn();
        if (args.Contains("--debug-sign-out")) _ = model.SignOutAsync();
        // QA without clicking: records a meeting for that many seconds, then stops and queues it.
        if (Array.IndexOf(args, "--debug-record") is var at and >= 0 && at + 1 < args.Length && int.TryParse(args[at + 1], out var seconds))
        {
            _ = DebugRecordAsync(seconds);
        }
#endif
        if (args.Contains("--show-menu"))
        {
            // The menu as an ordinary window that stays open, for screenshots and QA.
            menu.Pinned = true;
            menu.WindowStartupLocation = WindowStartupLocation.CenterScreen;
            menu.ShowMenu();
        }
        else if (!launched || (!args.Contains("--background") && model.Auth != AuthState.SignedIn))
        {
            // Opened by hand (not at sign-in): show where it lives. First run: show the sign-in.
            menu.ShowMenu();
        }
    }

#if DEBUG
    private async Task DebugRecordAsync(int seconds)
    {
        if (model is null) return;
        await model.StartMeetingAsync();
        await Task.Delay(TimeSpan.FromSeconds(seconds));
        await model.StopMeetingAsync();
    }
#endif

    private void OnModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(AppModel.LiveWindowVisible) || live is null || model is null) return;
        if (model.LiveWindowVisible) live.Show();
        else live.Hide();
    }

    private void ShowSettings()
    {
        if (model is null) return;
        settings ??= CreateSettings(model);
        settings.Show();
        settings.Activate();
    }

    private SettingsWindow CreateSettings(AppModel app)
    {
        var window = new SettingsWindow(app);
        window.QuitRequested += Quit;
        return window;
    }

    private async void Quit()
    {
        if (quitting || model is null) return;
        quitting = true;
        // A meeting still recording: keep what was captured so far.
        await model.SaveRecordingOnQuitAsync();
        tray?.Dispose();
        await model.DisposeAsync();
        Log.Flush();
        Shutdown();
    }

    protected override void OnSessionEnding(SessionEndingCancelEventArgs e)
    {
        // Signing out of Windows: save the meeting, the queue picks it up next time.
        Quit();
        base.OnSessionEnding(e);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        instance.Dispose();
        base.OnExit(e);
    }
}
