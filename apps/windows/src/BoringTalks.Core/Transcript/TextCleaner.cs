using System.Text.RegularExpressions;

namespace BoringTalks.Core.Transcript;

/// <summary>Removes non-speech markers and the stock phrases models invent for silence.</summary>
public static partial class TextCleaner
{
    private static readonly string[] Inventions =
    [
        "thank you for watching", "thanks for watching", "subscribe to", "amara.org",
        "субтитры", "продолжение следует", "подписывайтесь", "спасибо за просмотр",
        "untertitel", "sous-titres",
    ];

    public static string Clean(string text)
    {
        var result = Whitespace().Replace(Markers().Replace(text, " "), " ").Trim();
        var lower = result.ToLowerInvariant();
        if (Inventions.Any(lower.Contains) || result.All(c => char.IsPunctuation(c) || char.IsWhiteSpace(c) || char.IsSymbol(c))) return "";
        return result;
    }

    [GeneratedRegex(@"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪+|<unk>")]
    private static partial Regex Markers();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}
