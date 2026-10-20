namespace BoringTalks.Core;

/// <summary>Modifier keys of a global shortcut; the values are Windows' MOD_ flags for RegisterHotKey.</summary>
[Flags]
public enum HotkeyModifiers
{
    None = 0,
    Alt = 1,
    Control = 2,
    Shift = 4,
    Win = 8,
}

/// <summary>
/// A global shortcut such as "Ctrl+Alt+R": at least one modifier and a letter, digit, F-key or Space.
/// Written the same way in settings.json and in Settings.
/// </summary>
public sealed record Hotkey(HotkeyModifiers Modifiers, string Key)
{
    /// <summary>Starts and stops recording unless changed in Settings.</summary>
    public const string Default = "Ctrl+Alt+R";

    /// <summary>The shortcut in <paramref name="text"/>, or null when it is empty or not one.</summary>
    public static Hotkey? Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var parts = text.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2) return null;
        var modifiers = HotkeyModifiers.None;
        foreach (var part in parts[..^1])
        {
            var modifier = part.ToUpperInvariant() switch
            {
                "CTRL" or "CONTROL" => HotkeyModifiers.Control,
                "ALT" => HotkeyModifiers.Alt,
                "SHIFT" => HotkeyModifiers.Shift,
                "WIN" or "WINDOWS" => HotkeyModifiers.Win,
                _ => HotkeyModifiers.None,
            };
            if (modifier == HotkeyModifiers.None) return null;
            modifiers |= modifier;
        }
        return Create(modifiers, parts[^1]);
    }

    /// <summary>A shortcut from what was pressed (the Settings shortcut box); null without a modifier or a usable key.</summary>
    public static Hotkey? Create(HotkeyModifiers modifiers, string key)
    {
        if (modifiers == HotkeyModifiers.None) return null;
        var name = NormalizeKey(key);
        return name is null ? null : new Hotkey(modifiers, name);
    }

    /// <summary>The Windows virtual-key code for <see cref="Key"/>.</summary>
    public int VirtualKey => Key switch
    {
        "Space" => 0x20,
        [var c] => c,
        _ => 0x70 + int.Parse(Key[1..], System.Globalization.CultureInfo.InvariantCulture) - 1,
    };

    /// <summary>"Ctrl+Alt+Shift+Win+R": always this order.</summary>
    public override string ToString()
    {
        var parts = new List<string>();
        if (Modifiers.HasFlag(HotkeyModifiers.Control)) parts.Add("Ctrl");
        if (Modifiers.HasFlag(HotkeyModifiers.Alt)) parts.Add("Alt");
        if (Modifiers.HasFlag(HotkeyModifiers.Shift)) parts.Add("Shift");
        if (Modifiers.HasFlag(HotkeyModifiers.Win)) parts.Add("Win");
        parts.Add(Key);
        return string.Join("+", parts);
    }

    /// <summary>"R", "7" (also WPF's "D7"), "F5", "Space"; null for anything else.</summary>
    private static string? NormalizeKey(string key)
    {
        var k = key.Trim().ToUpperInvariant();
        if (k.Length == 1 && (char.IsAsciiLetterUpper(k[0]) || char.IsAsciiDigit(k[0]))) return k;
        if (k.Length == 2 && k[0] == 'D' && char.IsAsciiDigit(k[1])) return k[1..];
        if (k == "SPACE") return "Space";
        if (k.Length is 2 or 3 && k[0] == 'F' && int.TryParse(k[1..], out var n) && n is >= 1 and <= 24) return $"F{n}";
        return null;
    }
}
