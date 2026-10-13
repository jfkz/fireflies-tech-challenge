namespace BoringTalks.Core.Calls;

/// <summary>
/// Which running programs are games: the ones Windows' Game Bar recognised (its list in
/// <c>HKCU\System\GameConfigStore\Children</c>, <c>MatchedExeFullPath</c>), and anything run from
/// a game library folder (Steam, Epic, Xbox, GOG, EA, Ubisoft, Riot, Battle.net…), except the
/// launchers, crash reporters, anti-cheat services and installers that live there too.
/// </summary>
public static class GameDetector
{
    private static readonly string[] Libraries =
    [
        @"\steamapps\common\", @"\epic games\", @"\xboxgames\", @"\gog galaxy\games\", @"\gog games\",
        @"\ea games\", @"\origin games\", @"\ubisoft game launcher\games\", @"\riot games\", @"\battle.net\games\",
        @"\games\",
    ];

    private static readonly string[] NotGames =
    [
        "launcher", "crash", "report", "anticheat", "anti-cheat", "easyanticheat", "beservice", "battleye",
        "redist", "vcredist", "vc_redist", "dxsetup", "directx", "setup", "install", "unins", "helper",
        "updater", "update", "webhelper", "cefprocess", "overlay", "steamservice", "steam.exe",
        "epicgameslauncher", "eosoverlay", "ubisoftconnect", "upc.exe", "riotclient", "battle.net", "galaxyclient",
    ];

    /// <summary>The game's name when <paramref name="exePath"/> is one, else null.</summary>
    public static string? GameName(string exePath, IReadOnlySet<string> recognised)
    {
        if (string.IsNullOrWhiteSpace(exePath) || !exePath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) return null;
        var file = Path.GetFileName(exePath).ToLowerInvariant();
        if (NotGames.Any(file.Contains)) return null;
        var lower = exePath.ToLowerInvariant();
        var known = recognised.Contains(exePath);
        var library = Libraries.FirstOrDefault(lower.Contains);
        if (!known && library is null) return null;
        // The folder right under the library ("…\steamapps\common\Cyberpunk 2077\bin\x64\…"), else the file.
        if (library is not null)
        {
            var rest = exePath[(lower.IndexOf(library, StringComparison.Ordinal) + library.Length)..];
            // Past Steam's own folders in a library that isn't Steam's ("D:\Games\common\Among Us\…").
            var folder = rest.Split('\\', StringSplitOptions.RemoveEmptyEntries)
                .SkipWhile(f => f.Equals("common", StringComparison.OrdinalIgnoreCase) || f.Equals("steamapps", StringComparison.OrdinalIgnoreCase))
                .FirstOrDefault();
            if (folder is not null && !folder.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) return folder;
        }
        return Path.GetFileNameWithoutExtension(exePath);
    }
}

public abstract record GameEvent(string Game)
{
    public sealed record Started(string Game) : GameEvent(Game);
    public sealed record Ended(string Game) : GameEvent(Game);
}

/// <summary>
/// Turns "which games run now" (checked every few seconds) into Started / Ended: a game counts once
/// it has run for <see cref="StartAfter"/> (not a launcher blip), and has ended once it's been gone
/// for <see cref="EndAfter"/> (not a restart into another executable).
/// </summary>
public sealed class GameWatch
{
    public const double StartAfter = 10;
    public const double EndAfter = 20;

    private readonly Dictionary<string, double> seen = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, double> gone = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> started = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>The games that count as running now.</summary>
    public IReadOnlyCollection<string> Running => started;

    public IReadOnlyList<GameEvent> Update(IReadOnlyCollection<string> running, double now)
    {
        var events = new List<GameEvent>();
        // The name as first seen, whatever case a later check reports it in.
        foreach (var game in running.Select(g => seen.Keys.FirstOrDefault(k => k.Equals(g, StringComparison.OrdinalIgnoreCase)) ?? g))
        {
            gone.Remove(game);
            seen.TryAdd(game, now);
            if (!started.Contains(game) && now - seen[game] >= StartAfter)
            {
                started.Add(game);
                events.Add(new GameEvent.Started(game));
            }
        }
        foreach (var game in seen.Keys.Where(g => !running.Contains(g, StringComparer.OrdinalIgnoreCase)).ToList())
        {
            if (!started.Contains(game))
            {
                seen.Remove(game);
                continue;
            }
            gone.TryAdd(game, now);
            if (now - gone[game] < EndAfter) continue;
            seen.Remove(game);
            gone.Remove(game);
            started.Remove(game);
            events.Add(new GameEvent.Ended(game));
        }
        return events;
    }
}
