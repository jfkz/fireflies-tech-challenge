using System.ComponentModel;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows;
using System.Windows.Controls;
using H.NotifyIcon;
using BoringTalks.App.Recording;
using BoringTalks.App.ViewModels;
using BoringTalks.Core;

namespace BoringTalks.App.Views;

/// <summary>
/// The icon in the notification area: the app icon, with a red dot while recording and a
/// periwinkle one while a call is waiting for an answer. Left click opens the menu; right click
/// has the essentials.
/// </summary>
public sealed class TrayIcon : IDisposable
{
    private readonly TaskbarIcon icon;
    private readonly AppModel app;
    private readonly Icon idle;
    private readonly Icon recording;
    private readonly Icon calling;
    private readonly MenuItem recordItem;
    private Icon? shown;

    public TrayIcon(AppModel app, Action openMenu, Action openSettings, Action quit)
    {
        this.app = app;
        using var source = System.Windows.Application.GetResourceStream(new Uri("pack://application:,,,/Assets/BoringTalks.ico")).Stream;
        using var baseIcon = new Icon(source, 32, 32);
        idle = (Icon)baseIcon.Clone();
        recording = WithDot(baseIcon, Color.FromArgb(0xE0, 0x32, 0x3F));
        calling = WithDot(baseIcon, Color.FromArgb(0x5B, 0x67, 0xF5));

        recordItem = new MenuItem { Header = "Start meeting" };
        recordItem.Click += async (_, _) =>
        {
            if (app.Recorder.IsRecording) await app.StopMeetingAsync();
            else await app.StartMeetingAsync();
        };
        var menu = new ContextMenu();
        menu.Items.Add(Item($"Open {AppFlavor.Current.Name}", openMenu));
        menu.Items.Add(recordItem);
        menu.Items.Add(Item("Dashboard", app.OpenDashboard));
        menu.Items.Add(Item("Settings…", openSettings));
        menu.Items.Add(new Separator());
        menu.Items.Add(Item($"Quit {AppFlavor.Current.Name}", quit));

        icon = new TaskbarIcon
        {
            Icon = (Icon)idle.Clone(),
            ToolTipText = AppFlavor.Current.Name,
            ContextMenu = menu,
            NoLeftClickDelay = true,
        };
        icon.TrayLeftMouseUp += (_, _) => openMenu();
        icon.ForceCreate(enablesEfficiencyMode: false);

        app.PropertyChanged += Update;
        app.Recorder.PropertyChanged += Update;
        Update(null, new PropertyChangedEventArgs(null));
    }

    private static MenuItem Item(string header, Action action)
    {
        var item = new MenuItem { Header = header };
        item.Click += (_, _) => action();
        return item;
    }

    private void Update(object? sender, PropertyChangedEventArgs e)
    {
        var recorder = app.Recorder;
        if (recorder.Phase != RecorderPhase.Idle)
        {
            Show(recording);
            icon.ToolTipText = recorder.Phase == RecorderPhase.Finishing ? $"{AppFlavor.Current.Name} — finishing the transcript" : $"{AppFlavor.Current.Name} — recording";
        }
        else if (app.CallOffer is { } offer)
        {
            // A call started: visible even with notifications off.
            Show(calling);
            icon.ToolTipText = $"{AppFlavor.Current.Name} — {offer} is in a call";
        }
        else
        {
            Show(idle);
            icon.ToolTipText = app.Uploads.Waiting > 0 ? $"{AppFlavor.Current.Name} — {app.Uploads.Waiting} uploading" : AppFlavor.Current.Name;
        }
        recordItem.Header = recorder.IsRecording ? "Stop meeting" : "Start meeting";
        recordItem.IsEnabled = recorder.Phase is RecorderPhase.Idle or RecorderPhase.Recording && app.Auth == AuthState.SignedIn;
    }

    /// <summary>The tray takes ownership of (and disposes) each icon it is given, so it gets a copy, and only on a change.</summary>
    private void Show(Icon next)
    {
        if (ReferenceEquals(shown, next)) return;
        shown = next;
        icon.Icon = (Icon)next.Clone();
    }

    /// <summary>The app icon with a status dot in the bottom-right corner.</summary>
    private static Icon WithDot(Icon baseIcon, Color color)
    {
        using var bitmap = baseIcon.ToBitmap();
        using (var g = Graphics.FromImage(bitmap))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var size = bitmap.Width * 0.5f;
            var rect = new RectangleF(bitmap.Width - size - 0.5f, bitmap.Height - size - 0.5f, size, size);
            using var fill = new SolidBrush(color);
            using var border = new Pen(Color.White, bitmap.Width / 16f);
            g.FillEllipse(fill, rect);
            g.DrawEllipse(border, rect);
        }
        return Icon.FromHandle(bitmap.GetHicon());
    }

    public void ShowMessage(string title, string message) => icon.ShowNotification(title, message);

    public void Dispose()
    {
        icon.Dispose();
        idle.Dispose();
        recording.Dispose();
        calling.Dispose();
    }
}
