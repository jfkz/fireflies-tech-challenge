using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using BoringTalks.App.ViewModels;
using BoringTalks.Core.Api;

namespace BoringTalks.App.Views;

/// <summary>
/// The tray menu: a borderless window above the notification area that hides when it loses focus,
/// like Windows' own flyouts. The Mac's menu-bar window, item for item.
/// </summary>
public partial class MenuWindow : Window
{
    private readonly MenuViewModel model;
    private DateTime hiddenAt;

    public MenuWindow(MenuViewModel model)
    {
        InitializeComponent();
        this.model = model;
        DataContext = model;
        Deactivated += (_, _) =>
        {
            if (!Pinned) HideMenu();
        };
        KeyDown += (_, e) =>
        {
            if (e.Key == Key.Escape && !Pinned) HideMenu();
        };
    }

    /// <summary>Shown as an ordinary window that stays open (<c>--show-menu</c>, for screenshots and QA).</summary>
    public bool Pinned { get; set; }

    /// <summary>Opens the menu above the tray, or closes it when the tray icon is clicked again.</summary>
    public void Toggle()
    {
        // A click on the tray icon first takes focus from the menu (hiding it), then arrives here.
        if (IsVisible || (DateTime.UtcNow - hiddenAt).TotalMilliseconds < 300)
        {
            HideMenu();
            return;
        }
        ShowMenu();
    }

    public void ShowMenu()
    {
        model.Ticking = true;
        if (!Pinned) PlaceAboveTray();
        Show();
        Activate();
        if (!Pinned) Dispatcher.BeginInvoke(PlaceAboveTray, System.Windows.Threading.DispatcherPriority.Loaded);
    }

    public void HideMenu()
    {
        if (!IsVisible) return;
        hiddenAt = DateTime.UtcNow;
        model.Ticking = false;
        Hide();
    }

    /// <summary>Bottom right of the work area, where the notification area is on a default taskbar.</summary>
    private void PlaceAboveTray()
    {
        var area = SystemParameters.WorkArea;
        var height = ActualHeight > 0 ? ActualHeight : 520;
        Left = area.Right - Width - 4;
        Top = Math.Max(area.Top, area.Bottom - height - 4);
    }

    // ---- Sign in

    private void SignIn_Click(object sender, RoutedEventArgs e) => model.App.SignIn();
    private void CopyLink_Click(object sender, RoutedEventArgs e) => model.App.CopySignInLink();
    private void CancelSignIn_Click(object sender, RoutedEventArgs e) => model.App.CancelSignIn();

    private void Paste_Click(object sender, RoutedEventArgs e)
    {
        model.App.SubmitPasted(PasteBox.Text);
        PasteBox.Clear();
    }

    private void PasteBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) Paste_Click(sender, e);
    }

    // ---- Recording

    private async void Record_Click(object sender, RoutedEventArgs e)
    {
        if (model.Recorder.IsRecording) await model.App.StopMeetingAsync();
        else await model.App.StartMeetingAsync();
    }

    private void Keep_Click(object sender, RoutedEventArgs e) => model.App.KeepRecording();
    private void RecordCall_Click(object sender, RoutedEventArgs e) => model.App.RecordCall();
    private void NotNow_Click(object sender, RoutedEventArgs e) => model.App.DeclineCall();

    private void Never_Click(object sender, RoutedEventArgs e)
    {
        if (model.App.CallOffer is { } app) model.App.IgnoreCallApp(app);
    }

    private void DismissNotice_Click(object sender, RoutedEventArgs e) => model.App.DismissAutoStopNotice();
    private void RestartToUpdate_Click(object sender, RoutedEventArgs e) => model.App.RestartToUpdate();
    private void RetryModels_Click(object sender, RoutedEventArgs e) => model.App.RetryModels();
    private void Live_Click(object sender, RoutedEventArgs e) => model.App.ToggleLiveWindow();

    // ---- Uploads and meetings

    private void Retry_Click(object sender, RoutedEventArgs e) => model.App.RetryUploads();

    private void Discard_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: Guid id }) model.App.DiscardUpload(id);
    }

    private void Refresh_Click(object sender, RoutedEventArgs e) => model.App.RefreshMeetings();

    private void Meeting_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: MeetingListItem meeting }) model.App.OpenMeeting(meeting);
    }

    // ---- Footer

    private void Dashboard_Click(object sender, RoutedEventArgs e) => model.App.OpenDashboard();

    private void Settings_Click(object sender, RoutedEventArgs e)
    {
        HideMenu();
        SettingsRequested?.Invoke();
    }

    private void Quit_Click(object sender, RoutedEventArgs e) => QuitRequested?.Invoke();

    public event Action? SettingsRequested;
    public event Action? QuitRequested;
}
