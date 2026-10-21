using System.Runtime.InteropServices;
using System.Windows.Interop;
using BoringTalks.Core;

namespace BoringTalks.App.Platform;

/// <summary>
/// A shortcut that works in any app (Settings › Recording, "Ctrl+Alt+R" by default): Windows'
/// RegisterHotKey on a message-only window of the UI thread, which gets WM_HOTKEY when it is pressed.
/// Create, register and dispose it on the UI thread.
/// </summary>
public sealed class GlobalHotkey : IDisposable
{
    private const int WmHotkey = 0x0312;
    private const int Id = 0xB071;
    /// <summary>Held down, it fires once, not again and again.</summary>
    private const uint ModNoRepeat = 0x4000;

    private HwndSource? window;
    private bool registered;

    /// <summary>On the UI thread.</summary>
    public event Action? Pressed;

    /// <summary>The shortcut in force, if any.</summary>
    public Hotkey? Current { get; private set; }

    /// <summary>Replaces the shortcut (null: none). Returns why it couldn't be, or null.</summary>
    public string? Register(Hotkey? hotkey)
    {
        Unregister();
        if (hotkey is null) return null;
        if (window is null)
        {
            // HWND_MESSAGE: a window that is never shown and only receives messages.
            window = new HwndSource(new HwndSourceParameters("BoringTalks shortcut") { ParentWindow = new IntPtr(-3), WindowStyle = 0 });
            window.AddHook(Hook);
        }
        if (!RegisterHotKey(window.Handle, Id, (uint)hotkey.Modifiers | ModNoRepeat, (uint)hotkey.VirtualKey))
        {
            return $"{hotkey} is already used by another app. Pick another shortcut.";
        }
        registered = true;
        Current = hotkey;
        return null;
    }

    private void Unregister()
    {
        if (registered && window is not null) UnregisterHotKey(window.Handle, Id);
        registered = false;
        Current = null;
    }

    private IntPtr Hook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WmHotkey && wParam.ToInt32() == Id)
        {
            handled = true;
            Pressed?.Invoke();
        }
        return IntPtr.Zero;
    }

    public void Dispose()
    {
        Unregister();
        window?.Dispose();
        window = null;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
}
