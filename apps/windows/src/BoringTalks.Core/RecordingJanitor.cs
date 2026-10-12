namespace BoringTalks.Core;

/// <summary>Deletes recordings that have uploaded and aged past the "keep audio" setting.</summary>
public static class RecordingJanitor
{
    /// <summary>
    /// Removes <c>.m4a</c> files in <paramref name="folder"/> older than <paramref name="keepDays"/>,
    /// except <paramref name="protectedFiles"/> (still in the upload queue, or being recorded).
    /// Returns the names it deleted.
    /// </summary>
    public static IReadOnlyList<string> Prune(string folder, int keepDays, IReadOnlySet<string> protectedFiles, DateTimeOffset? now = null)
    {
        if (!Directory.Exists(folder)) return [];
        var cutoff = (now ?? DateTimeOffset.UtcNow) - TimeSpan.FromDays(Math.Max(0, keepDays));
        var deleted = new List<string>();
        foreach (var file in Directory.EnumerateFiles(folder, "*.m4a"))
        {
            var name = Path.GetFileName(file);
            if (protectedFiles.Contains(name)) continue;
            try
            {
                if (File.GetLastWriteTimeUtc(file) >= cutoff.UtcDateTime) continue;
                File.Delete(file);
                deleted.Add(name);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                // In use (being played?) or locked: try again next time.
            }
        }
        deleted.Sort(StringComparer.Ordinal);
        return deleted;
    }
}
