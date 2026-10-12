using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using BoringTalks.Core.Api;

namespace BoringTalks.Core.Tests;

public sealed class ApiClientTests
{
    private StubHandler handler = new((_, _) => (HttpStatusCode.OK, "{}"));

    private ApiClient Client(string? token = "btd_test", string baseUrl = "https://api.example.com") =>
        new(new Uri(baseUrl), new HttpClient(handler), _ => ValueTask.FromResult(token), "BoringTalks-Windows/test");

    private void Answer(HttpStatusCode status, string body) => handler = new StubHandler((_, _) => (status, body));

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Lists_meetings_with_the_shared_schema()
    {
        Answer(HttpStatusCode.OK, Fixture.Text("meeting-page"));
        var page = await Client().ListMeetingsAsync(5, Token);
        var request = handler.Requests.Single();
        Assert.Equal(HttpMethod.Get, request.Request.Method);
        Assert.Equal("https://api.example.com/meetings?limit=5", request.Request.RequestUri!.ToString());
        Assert.Equal("Bearer btd_test", request.Header("Authorization"));
        Assert.Equal("BoringTalks-Windows/test", request.Header("User-Agent"));
        Assert.Null(request.Body);

        Assert.Equal(2, page.Items.Count);
        Assert.Equal("eyJzdGFydGVkQXQiOiIyMDI2LTEwLTA1In0", page.NextCursor);
        var first = page.Items[0];
        Assert.Equal("Pricing review: Pro to $29, launch Nov 3", first.Title);
        Assert.Equal(MeetingStatus.Ready, first.Status);
        Assert.Equal(MeetingSource.Windows, first.Source);
        Assert.Equal(1_820, first.DurationSec);
        Assert.Equal(["You", "Speaker 1", "Speaker 2"], first.Speakers);
        Assert.Equal(["Pricing"], first.Topics);
        Assert.Equal(ApiJson.Parse("2026-10-06T09:30:00Z"), first.StartedAt);
        // Dates without milliseconds and null fields decode too.
        Assert.Equal(MeetingStatus.Summarizing, page.Items[1].Status);
        Assert.Equal(MeetingSource.Browser, page.Items[1].Source);
        Assert.Null(page.Items[1].Description);
        Assert.Null(page.Items[1].DurationSec);
        Assert.Equal(ApiJson.Parse("2026-10-05T16:00:00.000Z"), page.Items[1].StartedAt);
    }

    [Fact]
    public void Unknown_statuses_and_sources_do_not_break_the_list()
    {
        static string Item(string status, string source) =>
            $$"""{"id":"x","title":"T","description":null,"status":"{{status}}","source":"{{source}}","startedAt":"2026-10-06T09:30:00Z","durationSec":1,"speakers":[],"topics":[],"actionItemCount":0,"hasAudio":false}""";
        var json = $$"""{"items":[{{Item("archived", "bot")}},{{Item("ready", "telepathy")}},{{Item("failed", "macos")}}],"nextCursor":null}""";
        var page = JsonSerializer.Deserialize<MeetingPage>(json, ApiJson.Options)!;
        Assert.Equal([MeetingStatus.Summarizing, MeetingStatus.Ready, MeetingStatus.Failed], page.Items.Select(i => i.Status));
        Assert.Equal([MeetingSource.Unknown, MeetingSource.Unknown, MeetingSource.Macos], page.Items.Select(i => i.Source));
    }

    [Fact]
    public async Task The_device_token_exchange_is_unauthenticated()
    {
        Answer(HttpStatusCode.OK, Fixture.Text("device-token-response"));
        var response = await Client(token: null).ExchangeDeviceCodeAsync(new DeviceTokenRequest("one-time", "dBjftJeZ4CVP-mB92K27uhbUJU1p1r7wW1gFWFOEjXk"), Token);
        var recorded = handler.Requests.Single();
        Assert.Equal(HttpMethod.Post, recorded.Request.Method);
        Assert.Equal("/devices/token", recorded.Request.RequestUri!.AbsolutePath);
        Assert.Null(recorded.Header("Authorization"));
        Assert.StartsWith("application/json", recorded.Header("Content-Type"));
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse("""{"code":"one-time","codeVerifier":"dBjftJeZ4CVP-mB92K27uhbUJU1p1r7wW1gFWFOEjXk"}"""), recorded.BodyJson));
        Assert.StartsWith("btd_", response.Token);
        Assert.Equal("mike@example.com", response.User.Email);
    }

    [Fact]
    public async Task Creating_a_meeting_leaves_out_absent_fields()
    {
        Answer(HttpStatusCode.Created, Fixture.Text("created-meeting"));
        var created = await Client().CreateMeetingAsync(new CreateMeetingRequest(null, ApiJson.Parse("2026-10-06T09:30:00.250Z"), null), "k1", Token);
        Assert.Equal("0b9a1e8e-2f4c-4d3a-9b8e-1c2d3e4f5a6b", created.Id);
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse("""{"source":"windows","startedAt":"2026-10-06T09:30:00.250Z"}"""), handler.Requests[0].BodyJson), handler.Requests[0].Body);
        Assert.Equal("k1", handler.Requests[0].Header("Idempotency-Key"));
    }

    [Fact]
    public async Task Upload_url_request_and_response()
    {
        Answer(HttpStatusCode.OK, Fixture.Text("upload-url-response"));
        var target = await Client().RequestUploadUrlAsync("m1", new UploadUrlRequest(123_456), Token);
        var recorded = handler.Requests.Single();
        Assert.Equal("/meetings/m1/upload-url", recorded.Request.RequestUri!.AbsolutePath);
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse("""{"contentType":"audio/mp4","sizeBytes":123456}"""), recorded.BodyJson));
        Assert.Equal(new Dictionary<string, string> { ["Content-Type"] = "audio/mp4" }, target.Headers);
        Assert.Equal(900, target.ExpiresInSec);
        Assert.Equal("storage.example.com", target.Url.Host);
    }

    [Fact]
    public async Task A_base_url_with_a_path_prefix()
    {
        Answer(HttpStatusCode.OK, """{"items":[],"nextCursor":null}""");
        await Client(baseUrl: "http://localhost:3001/api").ListMeetingsAsync(1, Token);
        Assert.Equal("http://localhost:3001/api/meetings?limit=1", handler.Requests[0].Request.RequestUri!.ToString());
    }

    [Theory]
    [InlineData(400, "error-400", ApiErrorKind.Rejected, "Validation failed")]
    [InlineData(401, "", ApiErrorKind.Unauthorized, "")]
    [InlineData(403, """{"statusCode":403,"message":"Forbidden"}""", ApiErrorKind.Rejected, "Forbidden")]
    [InlineData(404, "", ApiErrorKind.NotFound, "")]
    [InlineData(408, "", ApiErrorKind.Server, "")]
    [InlineData(409, "", ApiErrorKind.Conflict, "")]
    [InlineData(429, "slow down", ApiErrorKind.Server, "slow down")]
    [InlineData(503, "", ApiErrorKind.Server, "")]
    public async Task Errors_map_to_what_the_app_does_about_them(int status, string body, ApiErrorKind kind, string detail)
    {
        Answer((HttpStatusCode)status, body == "error-400" ? Fixture.Text(body) : body);
        var error = await Assert.ThrowsAsync<ApiException>(() => Client().PutTranscriptAsync("m1", new TranscriptUpload(null, null, []), Token));
        Assert.Equal(kind, error.Kind);
        Assert.Equal(detail, error.Detail);
        Assert.Equal(status, error.Status);
        Assert.Equal(kind is ApiErrorKind.Server, error.IsRetryable);
    }

    [Fact]
    public void Error_messages_say_what_happened()
    {
        Assert.Equal("Signed out — sign in again.", new ApiException(ApiErrorKind.Unauthorized).Message);
        Assert.Equal("Not found on the server.", new ApiException(ApiErrorKind.NotFound).Message);
        Assert.Equal("Already done.", new ApiException(ApiErrorKind.Conflict).Message);
        Assert.Equal("Server error (502): Bad gateway", new ApiException(ApiErrorKind.Server, "Bad gateway", 502).Message);
        Assert.Equal("Unexpected server response: x", new ApiException(ApiErrorKind.Decoding, "x").Message);
    }

    [Fact]
    public async Task No_connection_is_offline()
    {
        handler = new StubHandler((_, _) => throw new HttpRequestException("No such host is known."));
        var error = await Assert.ThrowsAsync<ApiException>(() => Client().CompleteMeetingAsync("m1", new CompleteMeetingRequest(3), Token));
        Assert.Equal(ApiErrorKind.Offline, error.Kind);
        Assert.True(error.IsRetryable);
        Assert.Equal("Offline: No such host is known.", error.Message);
    }

    [Fact]
    public async Task Without_a_token_nothing_is_sent()
    {
        var error = await Assert.ThrowsAsync<ApiException>(() => Client(token: null).ListMeetingsAsync(5, Token));
        Assert.Equal(ApiErrorKind.Unauthorized, error.Kind);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task A_malformed_body_is_a_decoding_error()
    {
        Answer(HttpStatusCode.OK, """{"items":"nope"}""");
        var error = await Assert.ThrowsAsync<ApiException>(() => Client().ListMeetingsAsync(5, Token));
        Assert.Equal(ApiErrorKind.Decoding, error.Kind);
    }

    [Fact]
    public async Task Empty_success_bodies_are_fine()
    {
        Answer(HttpStatusCode.NoContent, "");
        await Client().CompleteMeetingAsync("m1", new CompleteMeetingRequest(null), Token);
        Assert.Equal("{}", handler.Requests[0].Body);
    }

    [Fact]
    public async Task The_presigned_upload_sends_the_file_with_its_headers()
    {
        using var folder = new TemporaryFolder();
        var file = folder.File("a.m4a");
        File.WriteAllBytes(file, Enumerable.Repeat((byte)1, 1_000).ToArray());
        Answer(HttpStatusCode.OK, "");
        var target = JsonSerializer.Deserialize<UploadUrlResponse>(Fixture.Text("upload-url-response"), ApiJson.Options)!;
        await Client().UploadAudioAsync(file, target, Token);
        var request = handler.Requests.Single();
        Assert.Equal(HttpMethod.Put, request.Request.Method);
        Assert.Equal(target.Url, request.Request.RequestUri);
        Assert.Equal("audio/mp4", request.Header("Content-Type"));
        Assert.Null(request.Header("Authorization"));
        Assert.Equal("<1000 bytes>", request.Body);

        Answer(HttpStatusCode.Forbidden, "<Error>SignatureDoesNotMatch</Error>");
        var error = await Assert.ThrowsAsync<ApiException>(() => Client().UploadAudioAsync(file, target, Token));
        Assert.Equal(ApiErrorKind.Rejected, error.Kind);
        Assert.Equal("<Error>SignatureDoesNotMatch</Error>", error.Detail);
    }

    [Fact]
    public void Dates_use_milliseconds_and_utc()
    {
        var date = DateTimeOffset.FromUnixTimeMilliseconds(1_791_278_400_500);
        Assert.Equal("2026-10-06T09:20:00.500Z", ApiJson.Format(date));
        Assert.Equal("2026-10-06T09:20:00.500Z", ApiJson.Format(date.ToOffset(TimeSpan.FromHours(3))));
        Assert.Equal(date, ApiJson.Parse("2026-10-06T09:20:00.500Z"));
        Assert.Equal(DateTimeOffset.FromUnixTimeSeconds(1_791_278_400), ApiJson.Parse("2026-10-06T09:20:00Z"));
        Assert.Null(ApiJson.Parse("yesterday"));
        Assert.Equal("\"2026-10-06T09:20:00.500Z\"", JsonSerializer.Serialize(date, ApiJson.Options));
        Assert.Equal("null", JsonSerializer.Serialize<DateTimeOffset?>(null, ApiJson.Options));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<DateTimeOffset>("\"soon\"", ApiJson.Options));
    }

    [Fact]
    public void Status_titles()
    {
        Assert.Equal("Recording", MeetingStatus.Recording.Title());
        Assert.Equal("Uploaded", MeetingStatus.Uploaded.Title());
        Assert.Equal("Transcribing", MeetingStatus.Transcribing.Title());
        Assert.Equal("Summarizing", MeetingStatus.Summarizing.Title());
        Assert.Equal("Ready", MeetingStatus.Ready.Title());
        Assert.Equal("Failed", MeetingStatus.Failed.Title());
        Assert.True(MeetingStatus.Transcribing.IsProcessing());
        Assert.False(MeetingStatus.Ready.IsProcessing());
    }
}
