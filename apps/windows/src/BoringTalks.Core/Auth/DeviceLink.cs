using System.Text;

namespace BoringTalks.Core.Auth;

/// <summary>
/// The browser half of signing a PC in: the page the app opens, and the
/// <c>boringtalks://callback?code=…</c> link the dashboard sends back.
/// </summary>
public static class DeviceLink
{
    public const string CallbackScheme = "boringtalks";
    public const string CallbackHost = "callback";

    /// <summary><c>https://boringtalks.lol/connect?challenge=&lt;c&gt;&amp;device=&lt;name&gt;</c>.</summary>
    public static Uri ConnectUrl(Uri webUrl, string challenge, string deviceName) =>
        new($"{webUrl.ToString().TrimEnd('/')}/connect?challenge={Encode(challenge)}&device={Encode(deviceName)}");

    /// <summary>The one-time code from the callback link.</summary>
    /// <exception cref="CallbackException">Not a callback, sign-in declined, or no code.</exception>
    public static string CodeFromCallback(string link)
    {
        if (!Uri.TryCreate(link.Trim(), UriKind.Absolute, out var url)
            || !url.Scheme.Equals(CallbackScheme, StringComparison.OrdinalIgnoreCase)
            || !url.Host.Equals(CallbackHost, StringComparison.OrdinalIgnoreCase))
        {
            throw new CallbackException(CallbackError.NotACallback);
        }
        var query = ParseQuery(url.Query);
        if (query.TryGetValue("error", out var error)) throw new CallbackException(CallbackError.Denied, error);
        if (!query.TryGetValue("code", out var code) || string.IsNullOrWhiteSpace(code)) throw new CallbackException(CallbackError.MissingCode);
        return code.Trim();
    }

    /// <summary>What the user pasted into "Paste code": the bare code, or the whole callback link.</summary>
    public static string? CodeFromPasted(string text)
    {
        var trimmed = text.Trim();
        if (trimmed.Length == 0) return null;
        if (trimmed.StartsWith($"{CallbackScheme}://", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                return CodeFromCallback(trimmed);
            }
            catch (CallbackException)
            {
                return null;
            }
        }
        return trimmed.Any(char.IsWhiteSpace) || trimmed.Length > 512 ? null : trimmed;
    }

    /// <summary>
    /// Percent-encodes everything but the RFC 3986 unreserved characters, so names
    /// like "Mike's PC &amp; Co" survive the trip.
    /// </summary>
    internal static string Encode(string value)
    {
        var builder = new StringBuilder();
        foreach (var b in Encoding.UTF8.GetBytes(value))
        {
            var c = (char)b;
            if (c is (>= 'a' and <= 'z') or (>= 'A' and <= 'Z') or (>= '0' and <= '9') or '-' or '.' or '_' or '~') builder.Append(c);
            else builder.Append('%').Append(b.ToString("X2"));
        }
        return builder.ToString();
    }

    private static Dictionary<string, string> ParseQuery(string query)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var pair in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var at = pair.IndexOf('=', StringComparison.Ordinal);
            var name = Uri.UnescapeDataString(at < 0 ? pair : pair[..at]);
            var value = at < 0 ? "" : Uri.UnescapeDataString(pair[(at + 1)..].Replace('+', ' '));
            result.TryAdd(name, value);
        }
        return result;
    }
}

public enum CallbackError
{
    NotACallback,
    Denied,
    MissingCode,
}

public sealed class CallbackException(CallbackError error, string reason = "") : Exception(error switch
{
    CallbackError.NotACallback => "That isn't a BoringTalks sign-in link.",
    CallbackError.Denied => $"Sign-in was cancelled ({reason}).",
    _ => "The sign-in link has no code in it.",
})
{
    public CallbackError Error { get; } = error;
}
