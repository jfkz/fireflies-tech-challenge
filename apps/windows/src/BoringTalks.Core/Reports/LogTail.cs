namespace BoringTalks.Core.Reports;

/// <summary>
/// The app's own log for a report: the lines of its newest daily files (<c>boringtalks-YYYYMMDD.log</c>),
/// earlier runs included, so a hang that ended with the app being killed still comes with what led up to it.
/// </summary>
public static class LogTail
{
    /// <param name="files">How many daily files, newest first (today and yesterday by default).</param>
    public static IReadOnlyList<string> Read(string folder, int files = 2)
    {
        if (!Directory.Exists(folder)) return [];
        var lines = new List<string>();
        foreach (var file in Directory.GetFiles(folder, "boringtalks-*.log").Order(StringComparer.OrdinalIgnoreCase).TakeLast(files))
        {
            try
            {
                // The log is open for writing; share it.
                using var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                using var reader = new StreamReader(stream);
                while (reader.ReadLine() is { } line) lines.Add(line);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                lines.Add($"[{Path.GetFileName(file)} couldn't be read: {error.Message}]");
            }
        }
        return lines;
    }
}
