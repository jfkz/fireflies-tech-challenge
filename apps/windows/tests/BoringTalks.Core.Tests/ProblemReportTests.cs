using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using BoringTalks.Core.Api;
using BoringTalks.Core.Reports;

namespace BoringTalks.Core.Tests;

public sealed class ProblemReportTests
{
    private static ProblemReportRequest Report(string message = "It froze", IReadOnlyDictionary<string, string>? diagnostics = null, string log = "") =>
        new(ProblemReportKind.User, message, new ProblemReportApp("0.5.8", "0.5.8", "dev"), new ProblemReportSystem("Windows 11 Pro", "LENOVO 21HM"),
            diagnostics ?? new Dictionary<string, string>(), log);

    [Fact]
    public async Task Is_sent_as_the_shared_contract_says()
    {
        var handler = new StubHandler((_, _) => (HttpStatusCode.Created, Fixture.Text("problem-report-response")));
        var api = new ApiClient(new Uri("https://api.example.com"), new HttpClient(handler), _ => ValueTask.FromResult<string?>("btd_test"));
        var expected = Fixture.Json("problem-report-request");
        var report = JsonSerializer.Deserialize<ProblemReportRequest>(expected.ToJsonString(), ApiJson.Options)!;
        Assert.Equal(ProblemReportKind.Hang, report.Kind);

        var response = await api.SendProblemReportAsync(report, TestContext.Current.CancellationToken);
        var sent = handler.Requests.Single();
        Assert.Equal("POST /reports", sent.Route);
        Assert.Equal("Bearer btd_test", sent.Header("Authorization"));
        // Diagnostics keys stay as they are ("hang.seconds", not camel-cased).
        Assert.True(JsonNode.DeepEquals(expected, sent.BodyJson), sent.Body);
        Assert.Equal("5b0e2a8c-6f1d-4c3e-9a7b-2d4e6f8a0b1c", response.Id);
        Assert.Equal(ApiJson.Parse("2026-10-14T11:41:02.517Z"), response.ReceivedAt);
    }

    [Fact]
    public void Keeps_the_newest_log_lines_that_fit()
    {
        Assert.Equal("a\nb", ProblemReport.Log(["a", "b"]));
        var lines = Enumerable.Range(0, 100).Select(i => $"line {i:00}").ToList();
        var log = ProblemReport.Log(lines, limit: 80 + 8 * 10);
        Assert.StartsWith("[90 older lines left out]\nline 90\n", log);
        Assert.EndsWith("line 99", log);
        Assert.Equal("", ProblemReport.Log([]));
    }

    [Fact]
    public void Fits_the_servers_limits()
    {
        var many = Enumerable.Range(0, 120).ToDictionary(i => $"k{i:000}", i => i == 0 ? new string('v', 3000) : "v");
        many[new string('x', 100)] = "long key";
        var fitted = ProblemReport.Fitted(Report($"  {new string('m', 5000)}  ", many, new string('l', ProblemReport.LogLimit + 10) + "end"));
        Assert.Equal(ProblemReport.MessageLimit, fitted.Message.Length);
        Assert.Equal(ProblemReport.DiagnosticsLimit, fitted.Diagnostics.Count);
        Assert.Equal(ProblemReport.DiagnosticValueLimit, fitted.Diagnostics["k000"].Length);
        Assert.Equal(ProblemReport.LogLimit, fitted.Log.Length);
        Assert.EndsWith("end", fitted.Log);
        Assert.Equal("Hi", ProblemReport.Fitted(Report(" Hi \n")).Message);
        var cut = ProblemReport.Fitted(Report() with
        {
            App = new ProblemReportApp(new string('1', 50), "0.5.8+" + new string('a', 40), "release"),
            System = new ProblemReportSystem(new string('w', 200), new string('m', 200)),
        });
        Assert.Equal((40, 40, 120, 120), (cut.App.Version.Length, cut.App.Build.Length, cut.System.Os.Length, cut.System.Model.Length));
        Assert.Equal(new string('x', ProblemReport.DiagnosticKeyLimit), ProblemReport.Fitted(Report(diagnostics: new Dictionary<string, string> { [new string('x', 100)] = "v" })).Diagnostics.Keys.Single());
    }

    [Fact]
    public void Reads_as_text_for_a_file()
    {
        var text = ProblemReport.Text(Report(diagnostics: new Dictionary<string, string> { ["b"] = "2", ["a"] = "1" }, log: "last line"));
        Assert.StartsWith("BoringTalks problem report (user)\nApp: 0.5.8 (0.5.8) dev\nSystem: Windows 11 Pro LENOVO 21HM\n\nIt froze\n", text);
        Assert.Contains("Diagnostics\n  a: 1\n  b: 2\n", text);
        Assert.EndsWith("\nLog\nlast line\n", text);
        var bare = ProblemReport.Text(Report(message: ""));
        Assert.Contains("(no message)", bare);
        Assert.DoesNotContain("Log", bare);
    }

    [Theory]
    [InlineData(38.4, "38 s")]
    [InlineData(60, "1 min")]
    [InlineData(252, "4 min 12 s")]
    [InlineData(7500, "2 h 5 min")]
    public void Describes_a_length_of_time(double seconds, string text) => Assert.Equal(text, ProblemReport.Describe(seconds));

    [Fact]
    public void Reads_the_newest_daily_logs_while_they_are_written()
    {
        using var folder = new TemporaryFolder();
        File.WriteAllText(folder.File("boringtalks-20261012.log"), "old\n");
        File.WriteAllText(folder.File("boringtalks-20261013.log"), "yesterday 1\nyesterday 2\n");
        File.WriteAllText(folder.File("other.txt"), "not a log\n");
        using (var open = new FileStream(folder.File("boringtalks-20261014.log"), FileMode.Create, FileAccess.Write, FileShare.Read))
        {
            open.Write("today\n"u8);
            open.Flush();
            Assert.Equal(["yesterday 1", "yesterday 2", "today"], LogTail.Read(folder.Path));
        }
        Assert.Equal(["today"], LogTail.Read(folder.Path, files: 1));
        Assert.Empty(LogTail.Read(folder.File("missing")));
    }
}

public sealed class HangWatchTests
{
    private static readonly DateTimeOffset Noon = new(2026, 10, 14, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Saves_a_hang_while_it_lasts_and_hands_it_back_when_it_ends()
    {
        using var folder = new TemporaryFolder();
        var store = new HangStore(folder.File("last-hang.json"));
        var lines = new List<string>();
        var watch = new HangWatch(store, threshold: 10, lines.Add);

        Assert.True(watch.Tick(0, Noon));
        Assert.Null(watch.Answered(0.2, Noon));
        Assert.True(watch.Tick(1, Noon.AddSeconds(1)));
        for (var t = 2; t <= 9; t++) Assert.False(watch.Tick(t, Noon.AddSeconds(t)));
        Assert.Null(store.Load());

        watch.Tick(11, Noon.AddSeconds(11));
        Assert.Equal(new Hang(Noon.AddSeconds(1), 10, Recovered: false), store.Load());
        for (var t = 12; t <= 16; t++) watch.Tick(t, Noon.AddSeconds(t));
        Assert.Equal(15, store.Load()!.Seconds);
        Assert.Equal(["the UI thread has not answered for 10 s"], lines);

        var ended = watch.Answered(31, Noon.AddSeconds(31));
        Assert.Equal(new Hang(Noon.AddSeconds(1), 30, Recovered: true), ended);
        Assert.Equal(ended, store.Load());
        Assert.Equal("the UI thread was stuck for 30 s", lines[^1]);

        store.Clear();
        Assert.Null(store.Load());
        store.Clear();
    }

    [Fact]
    public void A_hang_found_only_by_the_late_answer_is_still_kept()
    {
        using var folder = new TemporaryFolder();
        var store = new HangStore(folder.File("sub/last-hang.json"));
        var watch = new HangWatch(store, threshold: 5);
        watch.Tick(0, Noon);
        for (var t = 1; t <= 4; t++) watch.Tick(t, Noon.AddSeconds(t));
        Assert.Equal(new Hang(Noon.AddSeconds(-1), 5, Recovered: true), watch.Answered(5, Noon.AddSeconds(4)));
    }

    [Fact]
    public void A_damaged_file_is_no_hang()
    {
        using var folder = new TemporaryFolder();
        File.WriteAllText(folder.File("last-hang.json"), "{not json");
        Assert.Null(new HangStore(folder.File("last-hang.json")).Load());
    }
}
