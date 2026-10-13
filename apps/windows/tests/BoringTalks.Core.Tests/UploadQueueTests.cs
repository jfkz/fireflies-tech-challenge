using System.Net;
using System.Text.Json.Nodes;
using BoringTalks.Core.Api;
using BoringTalks.Core.Uploads;
using Microsoft.Extensions.Time.Testing;

namespace BoringTalks.Core.Tests;

/// <summary>The API and the storage bucket, answering through StubHandler.</summary>
internal sealed class FakeServer
{
    public const string MeetingId = "0b9a1e8e-2f4c-4d3a-9b8e-1c2d3e4f5a6b";
    private readonly Dictionary<string, Queue<int?>> planned = [];
    private readonly Lock gate = new();

    public FakeServer() => Handler = new StubHandler(Answer);

    public StubHandler Handler { get; }

    public IReadOnlyList<string> Routes => Handler.Routes;

    /// <summary>Planned answers per route, used up in order; null = no connection. Unlisted calls succeed.</summary>
    public void Plan(string route, params int?[] statuses)
    {
        lock (gate)
        {
            if (!planned.TryGetValue(route, out var queue)) planned[route] = queue = new Queue<int?>();
            foreach (var status in statuses) queue.Enqueue(status);
        }
    }

    private (HttpStatusCode, string) Answer(HttpRequestMessage request, string? body)
    {
        var route = StubHandler.RouteOf(request);
        bool hasPlan;
        int? status = null;
        lock (gate) hasPlan = planned.TryGetValue(route, out var queue) && queue.TryDequeue(out status);
        if (hasPlan)
        {
            if (status is null) throw new HttpRequestException("No internet connection.");
            if (status >= 300) return ((HttpStatusCode)status, status == 400 ? Fixture.Text("error-400") : $$"""{"statusCode":{{status}},"message":"Nope"}""");
        }
        return route switch
        {
            "POST /meetings" => (HttpStatusCode.Created, Fixture.Text("created-meeting")),
            $"POST /meetings/{MeetingId}/upload-url" => (HttpStatusCode.OK, Fixture.Text("upload-url-response")),
            "PUT storage" => (HttpStatusCode.OK, ""),
            $"PUT /meetings/{MeetingId}/transcript" => (HttpStatusCode.OK, """{"ok":true}"""),
            $"POST /meetings/{MeetingId}/complete" => (HttpStatusCode.Accepted, "{}"),
            _ => (HttpStatusCode.NotFound, """{"statusCode":404,"message":"Not Found"}"""),
        };
    }
}

public sealed class UploadQueueTests : IDisposable
{
    private const string Id = FakeServer.MeetingId;
    private readonly TemporaryFolder folder = new();
    private readonly FakeServer server = new();
    private readonly FakeTimeProvider clock = new(DateTimeOffset.FromUnixTimeSeconds(1_790_000_000));
    private readonly InMemoryUploadStore store = new();

    public void Dispose() => folder.Dispose();

    private UploadQueue MakeQueue(IUploadStore? store = null, int keepAudioDays = 7, string? token = "btd_test")
    {
        var api = new ApiClient(new Uri("https://api.example.com"), new HttpClient(server.Handler), _ => ValueTask.FromResult(token));
        return new UploadQueue(api, store ?? this.store, folder.Path, keepAudioDays, time: clock);
    }

    private PendingMeeting Meeting(Segment[]? segments = null, bool audio = true, bool uploadAudio = true)
    {
        var pending = new PendingMeeting
        {
            Title = "Weekly sync",
            StartedAt = DateTimeOffset.FromUnixTimeSeconds(1_791_278_400),
            DurationSec = 65,
            Language = "en",
            Segments = segments ??
            [
                new("Speaker 1", 0, 4_200, "Can everyone see my screen?"),
                new("You", 4_500, 6_100, "Yes, go ahead."),
            ],
            AudioFileName = audio ? $"{Guid.NewGuid()}.m4a" : null,
            UploadAudio = uploadAudio,
        };
        if (pending.AudioFileName is { } name) File.WriteAllBytes(folder.File(name), Enumerable.Repeat((byte)7, 2_048).ToArray());
        return pending;
    }

    private static readonly CancellationToken None = CancellationToken.None;

    // ---- Happy paths

    [Fact]
    public async Task Uploads_every_step_in_order()
    {
        var queue = MakeQueue();
        var item = Meeting();
        queue.Enqueue(item);
        await queue.ProcessDueAsync(None);

        Assert.Equal(["POST /meetings", $"POST /meetings/{Id}/upload-url", "PUT storage", $"PUT /meetings/{Id}/transcript", $"POST /meetings/{Id}/complete"], server.Routes);
        var snapshot = queue.Current;
        Assert.Empty(snapshot.Items);
        Assert.Equal(1, snapshot.UploadedCount);
        Assert.Equal(Id, snapshot.LastUploadedRemoteId);
        Assert.Empty(store.Load());

        var requests = server.Handler.Requests;
        // API calls carry the device token; the presigned PUT carries only its own headers.
        foreach (var r in requests.Where(r => r.Route != "PUT storage")) Assert.Equal("Bearer btd_test", r.Header("Authorization"));
        var put = requests.Single(r => r.Route == "PUT storage");
        Assert.Null(put.Header("Authorization"));
        Assert.Equal("audio/mp4", put.Header("Content-Type"));
        Assert.Equal("?X-Amz-Signature=abc", put.Request.RequestUri!.Query);

        var create = requests[0].BodyJson;
        Assert.Equal("windows", (string?)create["source"]);
        Assert.Equal("Weekly sync", (string?)create["title"]);
        Assert.Equal("en", (string?)create["language"]);
        Assert.Equal("2026-10-06T09:20:00.000Z", (string?)create["startedAt"]);
        Assert.Equal(item.Id.ToString(), requests[0].Header("Idempotency-Key"));
        Assert.StartsWith("BoringTalks-Windows", requests[0].Header("User-Agent"));

        var uploadUrl = requests[1].BodyJson;
        Assert.Equal("audio/mp4", (string?)uploadUrl["contentType"]);
        Assert.Equal(2_048, (int?)uploadUrl["sizeBytes"]);

        Assert.True(JsonNode.DeepEquals(Fixture.Json("transcript-upload"), requests[3].BodyJson), requests[3].Body);
        Assert.Equal(65, (int?)requests[4].BodyJson["durationSec"]);

        // Audio stays on this PC for the "keep" period.
        Assert.True(File.Exists(folder.File(item.AudioFileName!)));
    }

    [Fact]
    public async Task Audio_off_skips_the_audio_step()
    {
        var queue = MakeQueue();
        queue.Enqueue(Meeting(uploadAudio: false));
        await queue.ProcessDueAsync(None);
        Assert.Equal(["POST /meetings", $"PUT /meetings/{Id}/transcript", $"POST /meetings/{Id}/complete"], server.Routes);
    }

    [Fact]
    public async Task Without_a_transcript_the_audio_goes_up_for_the_server_to_transcribe()
    {
        var queue = MakeQueue();
        queue.Enqueue(Meeting(segments: [], uploadAudio: false));
        await queue.ProcessDueAsync(None);
        Assert.Equal(["POST /meetings", $"POST /meetings/{Id}/upload-url", "PUT storage", $"POST /meetings/{Id}/complete"], server.Routes);
    }

    [Fact]
    public async Task Upload_only_sends_both_sides_on_their_own_channels_for_the_server()
    {
        var queue = MakeQueue();
        queue.Enqueue(Meeting(segments: [], uploadAudio: true) with { AudioChannels = AudioChannelLayouts.MicSystem });
        await queue.ProcessDueAsync(None);
        Assert.Equal(["POST /meetings", $"POST /meetings/{Id}/upload-url", "PUT storage", $"POST /meetings/{Id}/complete"], server.Routes);
        var request = server.Handler.Requests.Single(r => r.Route.EndsWith("/upload-url", StringComparison.Ordinal));
        Assert.Equal("mic-system", request.BodyJson["channels"]!.GetValue<string>());
    }

    [Fact]
    public async Task One_mix_says_nothing_about_channels()
    {
        var queue = MakeQueue();
        queue.Enqueue(Meeting(segments: [], uploadAudio: true));
        await queue.ProcessDueAsync(None);
        var request = server.Handler.Requests.Single(r => r.Route.EndsWith("/upload-url", StringComparison.Ordinal));
        Assert.Null(request.BodyJson["channels"]);
    }

    [Fact]
    public async Task A_missing_audio_file_is_skipped()
    {
        var queue = MakeQueue();
        queue.Enqueue(Meeting() with { AudioFileName = "gone.m4a" });
        await queue.ProcessDueAsync(None);
        Assert.Equal(["POST /meetings", $"PUT /meetings/{Id}/transcript", $"POST /meetings/{Id}/complete"], server.Routes);
    }

    [Fact]
    public async Task Nothing_to_upload_fails()
    {
        var queue = MakeQueue();
        queue.Enqueue(Meeting(segments: [], audio: false));
        await queue.ProcessDueAsync(None);
        Assert.Empty(server.Routes);
        Assert.True(queue.Current.Items.Single().IsFailed);
    }

    [Fact]
    public async Task Keep_audio_zero_deletes_the_file_after_upload()
    {
        var queue = MakeQueue(keepAudioDays: 0);
        var item = Meeting();
        queue.Enqueue(item);
        await queue.ProcessDueAsync(None);
        Assert.False(File.Exists(folder.File(item.AudioFileName!)));
    }

    [Fact]
    public async Task A_long_title_is_clipped_to_the_api_limit()
    {
        var queue = MakeQueue();
        queue.Enqueue(Meeting(uploadAudio: false) with { Title = new string('x', 200) });
        await queue.ProcessDueAsync(None);
        Assert.Equal(ApiLimits.MaxTitleLength, ((string?)server.Handler.Requests[0].BodyJson["title"])!.Length);
    }

    // ---- Resuming

    [Theory]
    [InlineData(UploadStep.Audio, new[] { "POST /meetings/{0}/upload-url", "PUT storage", "PUT /meetings/{0}/transcript", "POST /meetings/{0}/complete" })]
    [InlineData(UploadStep.Transcript, new[] { "PUT /meetings/{0}/transcript", "POST /meetings/{0}/complete" })]
    [InlineData(UploadStep.Complete, new[] { "POST /meetings/{0}/complete" })]
    public async Task Resumes_from_each_step_after_a_relaunch(UploadStep step, string[] routes)
    {
        var item = Meeting() with { RemoteId = Id, Step = step };
        var file = new FileUploadStore(folder.File($"uploads-{step}.json"));
        file.Save([item]);

        // A fresh queue, as after a relaunch.
        var queue = MakeQueue(file);
        queue.Load();
        Assert.Equal(step, queue.Current.Items[0].Step);
        await queue.ProcessDueAsync(None);
        Assert.Equal(routes.Select(r => string.Format(r, Id)), server.Routes);
        Assert.Empty(file.Load());
    }

    [Fact]
    public async Task A_step_without_a_server_id_starts_over()
    {
        var queue = MakeQueue();
        queue.Enqueue(Meeting(uploadAudio: false) with { Step = UploadStep.Transcript });
        await queue.ProcessDueAsync(None);
        Assert.Equal(["POST /meetings", $"PUT /meetings/{Id}/transcript", $"POST /meetings/{Id}/complete"], server.Routes);
    }

    [Fact]
    public async Task Persists_progress_after_every_step()
    {
        var file = new FileUploadStore(folder.File("uploads.json"));
        var queue = MakeQueue(file);
        server.Plan($"POST /meetings/{Id}/complete", 503);
        queue.Enqueue(Meeting(uploadAudio: false));
        await queue.ProcessDueAsync(None);
        var saved = file.Load().Single();
        Assert.Equal(Id, saved.RemoteId);
        Assert.Equal(UploadStep.Complete, saved.Step);
        Assert.Equal(1, saved.Attempts);
    }

    // ---- Failures

    [Fact]
    public async Task Server_errors_retry_with_backoff_without_repeating_done_steps()
    {
        var queue = MakeQueue();
        server.Plan($"PUT /meetings/{Id}/transcript", 503, 502);
        queue.Enqueue(Meeting(uploadAudio: false));

        await queue.ProcessDueAsync(None);
        var item = queue.Current.Items.Single();
        Assert.Equal(UploadStep.Transcript, item.Step);
        Assert.Equal(1, item.Attempts);
        Assert.Equal(clock.GetUtcNow().AddSeconds(5), item.NextAttemptAt);
        Assert.False(item.IsFailed);

        // Not due yet: nothing happens.
        await queue.ProcessDueAsync(None);
        Assert.Equal(2, server.Routes.Count);

        clock.Advance(TimeSpan.FromSeconds(5));
        await queue.ProcessDueAsync(None);
        item = queue.Current.Items.Single();
        Assert.Equal(2, item.Attempts);
        Assert.Equal(clock.GetUtcNow().AddSeconds(10), item.NextAttemptAt);
        Assert.Equal(item.NextAttemptAt, queue.NextDueDate());

        clock.Advance(TimeSpan.FromSeconds(10));
        await queue.ProcessDueAsync(None);
        Assert.Empty(queue.Current.Items);
        // The meeting was created once, whatever happened after.
        Assert.Single(server.Routes, r => r == "POST /meetings");
    }

    [Fact]
    public async Task Offline_waits_and_reconnecting_retries_at_once()
    {
        var queue = MakeQueue();
        server.Plan("POST /meetings", [null]);
        queue.Enqueue(Meeting(uploadAudio: false));
        await queue.ProcessDueAsync(None);
        var snapshot = queue.Current;
        Assert.StartsWith("Offline", snapshot.Items[0].LastError);
        Assert.Equal(1, snapshot.Waiting);

        queue.SetOnline(false);
        clock.Advance(TimeSpan.FromSeconds(60));
        await queue.ProcessDueAsync(None);
        Assert.Single(server.Routes);
        Assert.Null(queue.NextDueDate());

        queue.SetOnline(true);
        Assert.Null(queue.Current.Items[0].NextAttemptAt);
        await queue.ProcessDueAsync(None);
        Assert.Empty(queue.Current.Items);
    }

    [Fact]
    public async Task Unauthorized_pauses_everything_until_signed_in_again()
    {
        var queue = MakeQueue();
        server.Plan("POST /meetings", 401);
        queue.Enqueue(Meeting(uploadAudio: false));
        queue.Enqueue(Meeting(uploadAudio: false));
        await queue.ProcessDueAsync(None);
        var snapshot = queue.Current;
        Assert.True(snapshot.NeedsSignIn);
        Assert.Equal(2, snapshot.Waiting);
        Assert.Equal(["POST /meetings"], server.Routes);

        queue.Resume();
        await queue.ProcessDueAsync(None);
        snapshot = queue.Current;
        Assert.False(snapshot.NeedsSignIn);
        Assert.Empty(snapshot.Items);
        Assert.Equal(2, snapshot.UploadedCount);
    }

    [Fact]
    public async Task No_token_counts_as_signed_out()
    {
        var queue = MakeQueue(token: null);
        queue.Enqueue(Meeting());
        await queue.ProcessDueAsync(None);
        Assert.True(queue.Current.NeedsSignIn);
        Assert.Empty(server.Routes);
    }

    [Fact]
    public async Task A_meeting_deleted_on_the_server_is_dropped()
    {
        var queue = MakeQueue();
        server.Plan($"PUT /meetings/{Id}/transcript", 404);
        queue.Enqueue(Meeting(uploadAudio: false));
        await queue.ProcessDueAsync(None);
        Assert.Empty(queue.Current.Items);
        Assert.Equal($"PUT /meetings/{Id}/transcript", server.Routes[^1]);
    }

    [Fact]
    public async Task Already_completed_counts_as_done()
    {
        var queue = MakeQueue();
        server.Plan($"POST /meetings/{Id}/complete", 409);
        queue.Enqueue(Meeting(uploadAudio: false));
        await queue.ProcessDueAsync(None);
        Assert.Empty(queue.Current.Items);
        Assert.Equal(1, queue.Current.UploadedCount);
    }

    [Fact]
    public async Task A_conflict_on_a_later_step_moves_on()
    {
        var queue = MakeQueue();
        server.Plan($"PUT /meetings/{Id}/transcript", 409);
        queue.Enqueue(Meeting(uploadAudio: false));
        await queue.ProcessDueAsync(None);
        Assert.Empty(queue.Current.Items);
        Assert.Equal(["POST /meetings", $"PUT /meetings/{Id}/transcript", $"POST /meetings/{Id}/complete"], server.Routes);
    }

    [Fact]
    public async Task A_rejected_request_fails_until_retried()
    {
        var queue = MakeQueue();
        server.Plan($"PUT /meetings/{Id}/transcript", 400);
        queue.Enqueue(Meeting(uploadAudio: false));
        await queue.ProcessDueAsync(None);
        var failed = queue.Current.Items.Single();
        Assert.True(failed.IsFailed);
        Assert.Equal(UploadStep.Transcript, failed.Step);
        Assert.Equal("Server refused the request (400): Validation failed", failed.LastError);
        Assert.Equal(1, queue.Current.Failed);

        clock.Advance(TimeSpan.FromHours(1));
        await queue.ProcessDueAsync(None);
        Assert.Equal(2, server.Routes.Count);

        queue.Retry(failed.Id);
        await queue.ProcessDueAsync(None);
        Assert.Empty(queue.Current.Items);
    }

    [Fact]
    public void Discard_removes_a_meeting()
    {
        var queue = MakeQueue();
        var item = Meeting();
        queue.SetOnline(false);
        queue.Enqueue(item);
        Assert.Equal([item.AudioFileName!], queue.ProtectedFiles);
        queue.Discard(item.Id);
        Assert.Empty(queue.Current.Items);
        Assert.Empty(store.Load());
    }

    [Fact]
    public async Task Observers_see_every_change()
    {
        var queue = MakeQueue();
        var seen = new List<UploadSnapshot>();
        queue.Changed += s => { lock (seen) seen.Add(s); };
        queue.Enqueue(Meeting(uploadAudio: false));
        await queue.ProcessDueAsync(None);
        Assert.Contains(seen, s => s.ActiveId is not null);
        Assert.Equal(1, seen[^1].UploadedCount);
    }

    [Fact]
    public async Task The_background_loop_uploads_what_is_enqueued()
    {
        await using var queue = new UploadQueue(
            new ApiClient(new Uri("https://api.example.com"), new HttpClient(server.Handler), _ => ValueTask.FromResult<string?>("btd_test")),
            store, folder.Path);
        queue.Start();
        queue.Start();
        queue.Enqueue(Meeting(uploadAudio: false));
        for (var i = 0; i < 100 && queue.Current.Items.Count > 0; i++) await Task.Delay(50, TestContext.Current.CancellationToken);
        await queue.StopAsync();
        Assert.Empty(queue.Current.Items);
    }

    [Fact]
    public void A_damaged_queue_file_starts_empty()
    {
        var path = folder.File("broken.json");
        File.WriteAllText(path, "{not json");
        var queue = MakeQueue(new FileUploadStore(path));
        queue.Load();
        Assert.Empty(queue.Current.Items);
    }
}

public sealed class PendingMeetingTests
{
    [Fact]
    public void Steps_skip_what_there_is_nothing_for()
    {
        var item = new PendingMeeting { Segments = [new("You", 0, 1, "Hi")], AudioFileName = "a.m4a", UploadAudio = true };
        Assert.Equal(UploadStep.Audio, item.StepAfter(UploadStep.Create, true));
        Assert.Equal(UploadStep.Transcript, item.StepAfter(UploadStep.Create, false));
        Assert.Equal(UploadStep.Transcript, item.StepAfter(UploadStep.Audio, true));
        Assert.Equal(UploadStep.Complete, item.StepAfter(UploadStep.Transcript, true));
        Assert.Equal(UploadStep.Done, item.StepAfter(UploadStep.Complete, true));
        Assert.Equal(UploadStep.Done, item.StepAfter(UploadStep.Done, true));
        item = item with { Segments = [] };
        Assert.Equal(UploadStep.Complete, item.StepAfter(UploadStep.Audio, true));
        Assert.True(item.HasContent(true));
        Assert.False(item.HasContent(false));
    }

    [Fact]
    public void Backoff_doubles_up_to_the_cap()
    {
        var backoff = new Backoff();
        Assert.Equal(0, backoff.Delay(0).TotalSeconds);
        Assert.Equal(5, backoff.Delay(1).TotalSeconds);
        Assert.Equal(10, backoff.Delay(2).TotalSeconds);
        Assert.Equal(80, backoff.Delay(5).TotalSeconds);
        Assert.Equal(900, backoff.Delay(9).TotalSeconds);
        Assert.Equal(900, backoff.Delay(1_000).TotalSeconds);
    }

    [Fact]
    public void The_file_store_round_trips()
    {
        using var folder = new TemporaryFolder();
        var store = new FileUploadStore(Path.Combine(folder.Path, "nested", "uploads.json"));
        Assert.Empty(store.Load());
        var item = new PendingMeeting
        {
            Title = "T",
            StartedAt = DateTimeOffset.FromUnixTimeMilliseconds(1_791_278_400_123),
            DurationSec = 5,
            Language = "en",
            AudioFileName = "x.m4a",
            RemoteId = "r1",
            Step = UploadStep.Complete,
            NextAttemptAt = DateTimeOffset.FromUnixTimeSeconds(1_791_278_500),
        };
        store.Save([item]);
        var loaded = store.Load().Single();
        Assert.Equal("r1", loaded.RemoteId);
        Assert.Equal(UploadStep.Complete, loaded.Step);
        Assert.Equal(item.StartedAt, loaded.StartedAt);
        Assert.Equal(item.NextAttemptAt, loaded.NextAttemptAt);
        Assert.Contains("\"step\":\"complete\"", File.ReadAllText(store.Path));
    }
}
