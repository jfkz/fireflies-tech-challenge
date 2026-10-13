using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using BoringTalks.App.ViewModels;
using BoringTalks.Core.Transcript;

namespace BoringTalks.App.Views;

/// <summary>One line of the live transcript, as the window shows it (previews in grey).</summary>
public sealed record LiveLine(string Speaker, string Time, string Text, Brush SpeakerBrush, double Opacity);

/// <summary>
/// The live transcript: finished phrases with speaker labels, plus what each side is saying right
/// now. Floats above other windows without taking focus or a place in Alt+Tab, so it can sit next
/// to the call.
/// </summary>
public partial class LiveTranscriptWindow : Window
{
    private static readonly Brush YouBrush = Frozen(Color.FromRgb(0xC2, 0x62, 0x0E));
    private static readonly Brush OthersBrush = Frozen(Color.FromRgb(0x38, 0x45, 0xDB));
    private readonly AppModel app;

    public LiveTranscriptWindow(AppModel app)
    {
        InitializeComponent();
        this.app = app;
        YouHead.Look = AvatarStyle.Talker;
        OthersHead.Look = AvatarStyle.Listener;
        YouHead.SinceSpeech = () => app.Recorder.Live.SinceSpeech(AudioChannel.Microphone);
        OthersHead.SinceSpeech = () => app.Recorder.Live.SinceSpeech(AudioChannel.System);
        app.Recorder.Live.Changed += Refresh;
        app.Recorder.PropertyChanged += (_, _) => AttachMeters();
        AttachMeters();
        Refresh();
        SourceInitialized += (_, _) => KeepOutOfAltTab();
    }

    private void AttachMeters()
    {
        YouHead.Meter = app.Recorder.Meter(AudioChannel.Microphone);
        OthersHead.Meter = app.Recorder.Meter(AudioChannel.System);
    }

    private void Refresh()
    {
        var live = app.Recorder.Live;
        var lines = live.Lines.Select(l => Show(l, 1)).ToList();
        foreach (var preview in live.Previews.Values.OrderBy(p => p.StartMs)) lines.Add(Show(preview, 0.55));
        var atBottom = Scroller.VerticalOffset >= Scroller.ScrollableHeight - 24;
        Lines.ItemsSource = lines;
        Empty.Visibility = lines.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        if (atBottom) Dispatcher.BeginInvoke(Scroller.ScrollToEnd, System.Windows.Threading.DispatcherPriority.Background);
    }

    private static LiveLine Show(LiveTranscript.Line line, double opacity)
    {
        var seconds = line.StartMs / 1000;
        var time = seconds >= 3600 ? $"{seconds / 3600}:{seconds / 60 % 60:00}:{seconds % 60:00}" : $"{seconds / 60}:{seconds % 60:00}";
        return new LiveLine(line.Speaker, time, line.Text, line.Channel == AudioChannel.Microphone ? YouBrush : OthersBrush, opacity);
    }

    /// <summary>Closing only hides it (and says so to the menu).</summary>
    protected override void OnClosing(CancelEventArgs e)
    {
        e.Cancel = true;
        app.LiveWindowVisible = false;
    }

    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr window, int index);

    [DllImport("user32.dll")]
    private static extern int SetWindowLong(IntPtr window, int index, int value);

    /// <summary>A tool window that never takes focus from the call.</summary>
    private void KeepOutOfAltTab()
    {
        const int exStyle = -20, toolWindow = 0x80, noActivate = 0x08000000;
        var handle = new WindowInteropHelper(this).Handle;
        _ = SetWindowLong(handle, exStyle, GetWindowLong(handle, exStyle) | toolWindow | noActivate);
    }

    private static Brush Frozen(Color color)
    {
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        return brush;
    }
}
