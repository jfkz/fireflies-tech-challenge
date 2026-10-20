using System.Text;
using BoringTalks.Core.Api;

namespace BoringTalks.Core.Reports;

/// <summary>Fitting a report to the server's limits, and the report as text for saving to a file.</summary>
public static class ProblemReport
{
    /// <summary>The server's limits (<c>PROBLEM_REPORT_LOG_LIMIT</c> and friends in packages/shared).</summary>
    public const int LogLimit = 1_000_000;
    public const int MessageLimit = 4000;
    public const int DiagnosticsLimit = 100;
    public const int DiagnosticKeyLimit = 80;
    public const int DiagnosticValueLimit = 2000;
    public const int VersionLimit = 40;
    public const int SystemLimit = 120;

    /// <summary>The newest lines that fit in <paramref name="limit"/> characters, oldest first, with a note when some were left out.</summary>
    public static string Log(IReadOnlyList<string> lines, int limit = LogLimit)
    {
        var kept = new List<string>();
        var size = 0;
        for (var i = lines.Count - 1; i >= 0; i--)
        {
            var cost = lines[i].Length + 1;
            if (size + cost > limit - 80) break;
            kept.Add(lines[i]);
            size += cost;
        }
        kept.Reverse();
        var dropped = lines.Count - kept.Count;
        var body = string.Join("\n", kept);
        return dropped > 0 ? $"[{dropped} older lines left out]\n{body}" : body;
    }

    /// <summary>Within the server's limits: the message trimmed and cut, at most 100 diagnostics, keys and values cut, the log's newest part.</summary>
    public static ProblemReportRequest Fitted(ProblemReportRequest request)
    {
        var message = request.Message.Trim();
        var diagnostics = request.Diagnostics
            .OrderBy(d => d.Key, StringComparer.Ordinal)
            .Take(DiagnosticsLimit)
            .GroupBy(d => Cut(d.Key, DiagnosticKeyLimit), StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => Cut(g.First().Value, DiagnosticValueLimit), StringComparer.Ordinal);
        var log = request.Log.Length > LogLimit ? request.Log[^LogLimit..] : request.Log;
        return request with
        {
            Message = Cut(message, MessageLimit),
            App = request.App with { Version = Cut(request.App.Version, VersionLimit), Build = Cut(request.App.Build, VersionLimit) },
            System = new ProblemReportSystem(Cut(request.System.Os, SystemLimit), Cut(request.System.Model, SystemLimit)),
            Diagnostics = diagnostics,
            Log = log,
        };
    }

    /// <summary>The report as plain text, for saving to a file when it can't be sent.</summary>
    public static string Text(ProblemReportRequest request)
    {
        var text = new StringBuilder();
        text.Append($"BoringTalks problem report ({request.Kind.ToString().ToLowerInvariant()})\n");
        text.Append($"App: {request.App.Version} ({request.App.Build}) {request.App.Flavor}\n");
        text.Append($"System: {request.System.Os} {request.System.Model}\n\n");
        text.Append(request.Message.Length == 0 ? "(no message)\n" : request.Message + "\n");
        text.Append("\nDiagnostics\n");
        foreach (var (key, value) in request.Diagnostics.OrderBy(d => d.Key, StringComparer.Ordinal)) text.Append($"  {key}: {value}\n");
        if (request.Log.Length > 0) text.Append($"\nLog\n{request.Log}\n");
        return text.ToString();
    }

    /// <summary>"4 min 12 s", "38 s", "2 h 5 min".</summary>
    public static string Describe(double seconds)
    {
        var total = (int)Math.Round(seconds);
        if (total < 60) return $"{total} s";
        var (minutes, rest) = (total / 60, total % 60);
        if (minutes < 60) return rest == 0 ? $"{minutes} min" : $"{minutes} min {rest} s";
        return $"{minutes / 60} h {minutes % 60} min";
    }

    private static string Cut(string text, int limit) => text.Length > limit ? text[..limit] : text;
}
