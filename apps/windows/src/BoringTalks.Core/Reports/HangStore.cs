using System.Text.Json;
using BoringTalks.Core.Api;

namespace BoringTalks.Core.Reports;

/// <summary>A time the UI thread stopped answering: the menu, Stop and call detection were frozen.</summary>
/// <param name="Recovered">False while it lasts, and when the app was quit or killed before it came back.</param>
public sealed record Hang(DateTimeOffset StartedAt, double Seconds, bool Recovered);

/// <summary>
/// The last hang not yet reported or dismissed, kept on disk (<c>last-hang.json</c>) so one that
/// ended with the app being killed is still offered for a report on the next launch.
/// </summary>
public sealed class HangStore(string path)
{
    public string Path { get; } = path;

    public Hang? Load()
    {
        try
        {
            return JsonSerializer.Deserialize<Hang>(File.ReadAllText(Path), ApiJson.Options);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }

    public void Save(Hang hang)
    {
        try
        {
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path)!);
            var temporary = Path + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(hang, ApiJson.Options));
            File.Move(temporary, Path, overwrite: true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
        }
    }

    public void Clear()
    {
        try
        {
            File.Delete(Path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
        }
    }
}
