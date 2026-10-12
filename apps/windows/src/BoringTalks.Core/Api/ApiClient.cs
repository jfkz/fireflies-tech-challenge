using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace BoringTalks.Core.Api;

/// <summary>What went wrong talking to the API, sorted by what to do about it.</summary>
public enum ApiErrorKind
{
    /// <summary>401: the device token is missing, revoked or expired. Sign in again.</summary>
    Unauthorized,
    /// <summary>404: the meeting is gone (deleted from the dashboard).</summary>
    NotFound,
    /// <summary>409: the request was already done (e.g. a meeting completed twice).</summary>
    Conflict,
    /// <summary>Another 4xx: the request itself is wrong; retrying won't help.</summary>
    Rejected,
    /// <summary>5xx, 408 or 429: the server is unwell or busy; retry later.</summary>
    Server,
    /// <summary>No connection, timeout, DNS…; retry later.</summary>
    Offline,
    /// <summary>The response didn't have the expected shape.</summary>
    Decoding,
}

public sealed class ApiException : Exception
{
    public ApiException(ApiErrorKind kind, string detail = "", int status = 0, Exception? inner = null)
        : base(Describe(kind, status, detail), inner)
    {
        Kind = kind;
        Status = status;
        Detail = detail;
    }

    public ApiErrorKind Kind { get; }
    public int Status { get; }
    public string Detail { get; }

    public bool IsRetryable => Kind is ApiErrorKind.Server or ApiErrorKind.Offline;

    private static string Describe(ApiErrorKind kind, int status, string detail) => kind switch
    {
        ApiErrorKind.Unauthorized => "Signed out — sign in again.",
        ApiErrorKind.NotFound => "Not found on the server.",
        ApiErrorKind.Conflict => "Already done.",
        ApiErrorKind.Rejected => $"Server refused the request ({status}): {detail}",
        ApiErrorKind.Server => $"Server error ({status}): {detail}",
        ApiErrorKind.Offline => $"Offline: {detail}",
        _ => $"Unexpected server response: {detail}",
    };
}

public interface IDeviceAuthApi
{
    Task<DeviceTokenResponse> ExchangeDeviceCodeAsync(DeviceTokenRequest request, CancellationToken cancellation = default);
}

/// <summary>Everything the upload queue and the menu need from the API.</summary>
public interface IMeetingsApi
{
    Task<CreatedMeeting> CreateMeetingAsync(CreateMeetingRequest request, string idempotencyKey, CancellationToken cancellation = default);
    Task<UploadUrlResponse> RequestUploadUrlAsync(string meetingId, UploadUrlRequest request, CancellationToken cancellation = default);
    /// <summary>PUTs the file to the presigned URL (straight to storage, not through the API).</summary>
    Task UploadAudioAsync(string file, UploadUrlResponse target, CancellationToken cancellation = default);
    Task PutTranscriptAsync(string meetingId, TranscriptUpload transcript, CancellationToken cancellation = default);
    Task CompleteMeetingAsync(string meetingId, CompleteMeetingRequest request, CancellationToken cancellation = default);
    Task<MeetingPage> ListMeetingsAsync(int limit, CancellationToken cancellation = default);
}

/// <summary>
/// The BoringTalks API over HttpClient. Every call carries the device token as a
/// bearer token, except the presigned upload, which carries its own signature.
/// </summary>
public sealed class ApiClient : IMeetingsApi, IDeviceAuthApi
{
    private readonly Uri baseUrl;
    private readonly HttpClient http;
    private readonly Func<CancellationToken, ValueTask<string?>> token;
    private readonly string userAgent;

    public ApiClient(Uri baseUrl, HttpClient http, Func<CancellationToken, ValueTask<string?>> token, string userAgent = "BoringTalks-Windows")
    {
        this.baseUrl = new Uri(baseUrl.ToString().TrimEnd('/') + "/");
        this.http = http;
        this.token = token;
        this.userAgent = userAgent;
    }

    public static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(30);
    public static readonly TimeSpan UploadTimeout = TimeSpan.FromMinutes(10);

    // ---- Endpoints

    public Task<DeviceTokenResponse> ExchangeDeviceCodeAsync(DeviceTokenRequest request, CancellationToken cancellation = default) =>
        SendAsync<DeviceTokenResponse>(HttpMethod.Post, "devices/token", request, authorized: false, cancellation: cancellation);

    public Task<CreatedMeeting> CreateMeetingAsync(CreateMeetingRequest request, string idempotencyKey, CancellationToken cancellation = default) =>
        SendAsync<CreatedMeeting>(HttpMethod.Post, "meetings", request, headers: new() { ["Idempotency-Key"] = idempotencyKey }, cancellation: cancellation);

    public Task<UploadUrlResponse> RequestUploadUrlAsync(string meetingId, UploadUrlRequest request, CancellationToken cancellation = default) =>
        SendAsync<UploadUrlResponse>(HttpMethod.Post, $"meetings/{Uri.EscapeDataString(meetingId)}/upload-url", request, cancellation: cancellation);

    public Task PutTranscriptAsync(string meetingId, TranscriptUpload transcript, CancellationToken cancellation = default) =>
        SendAsync<JsonElement?>(HttpMethod.Put, $"meetings/{Uri.EscapeDataString(meetingId)}/transcript", transcript, ignoreBody: true, cancellation: cancellation);

    public Task CompleteMeetingAsync(string meetingId, CompleteMeetingRequest request, CancellationToken cancellation = default) =>
        SendAsync<JsonElement?>(HttpMethod.Post, $"meetings/{Uri.EscapeDataString(meetingId)}/complete", request, ignoreBody: true, cancellation: cancellation);

    public Task<MeetingPage> ListMeetingsAsync(int limit, CancellationToken cancellation = default) =>
        SendAsync<MeetingPage>(HttpMethod.Get, $"meetings?limit={limit}", body: null, cancellation: cancellation);

    public async Task UploadAudioAsync(string file, UploadUrlResponse target, CancellationToken cancellation = default)
    {
        await using var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16, useAsync: true);
        using var content = new StreamContent(stream);
        using var request = new HttpRequestMessage(HttpMethod.Put, target.Url) { Content = content };
        foreach (var (name, value) in target.Headers)
        {
            if (!request.Headers.TryAddWithoutValidation(name, value)) content.Headers.TryAddWithoutValidation(name, value);
        }
        content.Headers.ContentType ??= new MediaTypeHeaderValue("audio/mp4");
        content.Headers.ContentLength = stream.Length;
        using var response = await PerformAsync(request, UploadTimeout, cancellation);
        await CheckAsync(response, cancellation);
    }

    // ---- Plumbing

    private async Task<T> SendAsync<T>(HttpMethod method, string path, object? body, Dictionary<string, string>? headers = null,
        bool authorized = true, bool ignoreBody = false, CancellationToken cancellation = default)
    {
        using var request = new HttpRequestMessage(method, new Uri(baseUrl, path));
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.TryAddWithoutValidation("User-Agent", userAgent);
        foreach (var (name, value) in headers ?? []) request.Headers.TryAddWithoutValidation(name, value);
        if (authorized)
        {
            var bearer = await token(cancellation) ?? throw new ApiException(ApiErrorKind.Unauthorized);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        }
        if (body is not null) request.Content = JsonContent.Create(body, body.GetType(), options: ApiJson.Options);

        using var response = await PerformAsync(request, RequestTimeout, cancellation);
        await CheckAsync(response, cancellation);
        if (ignoreBody) return default!;
        try
        {
            var value = await response.Content.ReadFromJsonAsync<T>(ApiJson.Options, cancellation);
            return value ?? throw new JsonException("empty body");
        }
        catch (JsonException error)
        {
            throw new ApiException(ApiErrorKind.Decoding, $"{method} /{path}: {error.Message}", inner: error);
        }
    }

    private async Task<HttpResponseMessage> PerformAsync(HttpRequestMessage request, TimeSpan timeout, CancellationToken cancellation)
    {
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        limit.CancelAfter(timeout);
        try
        {
            return await http.SendAsync(request, HttpCompletionOption.ResponseContentRead, limit.Token);
        }
        catch (HttpRequestException error)
        {
            throw new ApiException(ApiErrorKind.Offline, error.Message, inner: error);
        }
        catch (OperationCanceledException error) when (!cancellation.IsCancellationRequested)
        {
            throw new ApiException(ApiErrorKind.Offline, "The request timed out.", inner: error);
        }
    }

    private static async Task CheckAsync(HttpResponseMessage response, CancellationToken cancellation)
    {
        var status = (int)response.StatusCode;
        if (response.IsSuccessStatusCode) return;
        var text = await response.Content.ReadAsStringAsync(cancellation);
        string message;
        try
        {
            message = JsonSerializer.Deserialize<ApiErrorBody>(text, ApiJson.Options)?.Message ?? Clip(text);
        }
        catch (JsonException)
        {
            message = Clip(text);
        }
        throw response.StatusCode switch
        {
            HttpStatusCode.Unauthorized => new ApiException(ApiErrorKind.Unauthorized, message, status),
            HttpStatusCode.NotFound => new ApiException(ApiErrorKind.NotFound, message, status),
            HttpStatusCode.Conflict => new ApiException(ApiErrorKind.Conflict, message, status),
            HttpStatusCode.RequestTimeout or HttpStatusCode.TooManyRequests => new ApiException(ApiErrorKind.Server, message, status),
            _ when status >= 500 => new ApiException(ApiErrorKind.Server, message, status),
            _ => new ApiException(ApiErrorKind.Rejected, message, status),
        };
    }

    private static string Clip(string text) => text.Length > 300 ? text[..300] : text;
}
