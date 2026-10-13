using System.Net;
using System.Text;
using System.Text.Json.Nodes;

namespace BoringTalks.Core.Tests;

/// <summary>Contract fixtures from packages/shared/fixtures (copied next to the tests at build time).</summary>
public static class Fixture
{
    public static string Text(string name) => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", $"{name}.json"));

    public static JsonNode Json(string name) => JsonNode.Parse(Text(name))!;
}

/// <summary>One request the stub handler answered.</summary>
public sealed record Recorded(HttpRequestMessage Request, string? Body)
{
    public string Route => StubHandler.RouteOf(Request);

    public JsonNode BodyJson => JsonNode.Parse(Body ?? "null")!;

    public string? Header(string name) =>
        Request.Headers.TryGetValues(name, out var values) ? string.Join(",", values)
        : Request.Content?.Headers.TryGetValues(name, out var content) == true ? string.Join(",", content) : null;
}

/// <summary>Answers HttpClient requests in tests: the API and the presigned storage PUT.</summary>
public sealed class StubHandler(Func<HttpRequestMessage, string?, (HttpStatusCode Status, string Body)> answer) : HttpMessageHandler
{
    private readonly List<Recorded> recorded = [];
    private readonly Lock gate = new();

    public IReadOnlyList<Recorded> Requests
    {
        get { lock (gate) return [.. recorded]; }
    }

    public IReadOnlyList<string> Routes => [.. Requests.Select(r => r.Route)];

    public static string RouteOf(HttpRequestMessage request) =>
        request.RequestUri!.Host == "storage.example.com" ? $"{request.Method} storage" : $"{request.Method} {request.RequestUri.AbsolutePath}";

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? null
            : request.Content is StreamContent ? $"<{(await request.Content.ReadAsByteArrayAsync(cancellationToken)).Length} bytes>"
            : await request.Content.ReadAsStringAsync(cancellationToken);
        lock (gate) recorded.Add(new Recorded(request, body));
        var (status, text) = answer(request, body);
        return new HttpResponseMessage(status) { Content = new StringContent(text, Encoding.UTF8, "application/json") };
    }
}

/// <summary>A folder under %TEMP% that goes away with the test.</summary>
public sealed class TemporaryFolder : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"BoringTalksTests-{Guid.NewGuid():N}");

    public TemporaryFolder() => Directory.CreateDirectory(Path);

    public string File(string name) => System.IO.Path.Combine(Path, name);

    public void Dispose()
    {
        try
        {
            Directory.Delete(Path, recursive: true);
        }
        catch (IOException)
        {
        }
    }
}
