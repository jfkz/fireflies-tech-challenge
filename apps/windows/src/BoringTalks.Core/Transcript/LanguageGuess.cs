using System.Text.RegularExpressions;

namespace BoringTalks.Core.Transcript;

/// <summary>
/// The language of a transcript, when the user left it on "auto". Windows has no
/// built-in language identifier, so this counts the most common short words of
/// the languages Parakeet speaks; the language is only metadata for the summary.
/// </summary>
public static partial class LanguageGuess
{
    private static readonly Dictionary<string, HashSet<string>> Stopwords = new()
    {
        ["en"] = Set("the and is are to of a in that it you we for this on with be have not was what can will so"),
        ["de"] = Set("der die das und ist nicht ich wir sie es zu mit den auf für ein eine auch von dass wie"),
        ["fr"] = Set("le la les et est des une un que je nous vous pas pour dans ce qui sur avec mais est-ce"),
        ["es"] = Set("el la los las y es que de del al en un una por para no se con lo como pero muy está hay también todos vamos"),
        ["it"] = Set("il la le e è che di un una per non sono con lo gli ma come anche questo della"),
        ["pt"] = Set("o os as e é que de um uma para não com em do da dos das isso mas como você está também vamos"),
        ["nl"] = Set("de het een en is niet ik we je dat van op te voor met maar ook wat zijn"),
        ["pl"] = Set("i w na nie to że jest się z do jak ale co tak już czy jestem mamy"),
        ["sv"] = Set("och det är att en i som på för med inte jag vi har de till men"),
        ["da"] = Set("og det er at en i som på for med ikke jeg vi har de til men"),
        ["cs"] = Set("a je to v na že se s do jak ale co tak už jsem jsme není"),
        ["ro"] = Set("și este că de în un o pe nu cu la se ce mai dar sunt"),
        ["hu"] = Set("és a az hogy nem is egy van de meg ez csak már mit"),
        ["fi"] = Set("ja on ei se että mutta kun niin tämä me te minä sinä olla"),
    };

    /// <summary>ISO 639-1 code, or null for too little or mixed text.</summary>
    public static string? Detect(string text)
    {
        var words = Word().Matches(text.ToLowerInvariant()).Select(m => m.Value).ToList();
        if (words.Count < 3) return null;
        // The alphabet settles it for Greek and Cyrillic; Ukrainian has letters Russian doesn't.
        var letters = string.Concat(words).Where(char.IsLetter).ToList();
        if (letters.Count(c => c is >= 'α' and <= 'ω' or >= 'ά' and <= 'ώ') > letters.Count / 2) return "el";
        if (letters.Count(c => c is >= 'а' and <= 'я' or 'ё' or 'і' or 'ї' or 'є' or 'ґ') > letters.Count / 2)
        {
            return letters.Any(c => c is 'і' or 'ї' or 'є' or 'ґ') ? "uk" : "ru";
        }
        // Short words like "a" and "la" belong to several languages; the winner needs twice the runner-up's hits.
        var scores = Stopwords.Select(pair => (Language: pair.Key, Hits: words.Count(pair.Value.Contains))).OrderByDescending(s => s.Hits).ToList();
        return scores[0].Hits >= 2 && scores[0].Hits >= 2 * scores[1].Hits ? scores[0].Language : null;
    }

    private static HashSet<string> Set(string words) => [.. words.Split(' ')];

    [GeneratedRegex(@"[\p{L}'-]+")]
    private static partial Regex Word();
}
