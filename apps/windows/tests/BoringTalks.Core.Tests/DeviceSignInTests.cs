using System.Text.Json;
using BoringTalks.Core.Api;
using BoringTalks.Core.Auth;

namespace BoringTalks.Core.Tests;

public sealed class PkceTests
{
    [Fact]
    public void Matches_the_rfc_7636_appendix_b_vector()
    {
        // RFC 7636 Appendix B: the verifier is base64url of these 32 octets.
        byte[] octets = [116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121];
        Assert.Equal("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", Pkce.Base64Url(octets));
        Assert.Equal("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", new Pkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk").Challenge);
    }

    [Fact]
    public void A_generated_verifier_is_43_base64url_characters()
    {
        const string allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        for (var i = 0; i < 50; i++)
        {
            var pkce = Pkce.Generate();
            Assert.Equal(43, pkce.Verifier.Length);
            Assert.Equal(43, pkce.Challenge.Length);
            Assert.All(pkce.Verifier, c => Assert.Contains(c, allowed));
            Assert.All(pkce.Challenge, c => Assert.Contains(c, allowed));
            Assert.Equal(Pkce.ChallengeFor(pkce.Verifier), pkce.Challenge);
        }
        Assert.NotEqual(Pkce.Generate().Verifier, Pkce.Generate().Verifier);
    }

    [Fact]
    public void Base64url_has_no_padding_or_unsafe_characters()
    {
        Assert.Equal("-__-", Pkce.Base64Url([0xfb, 0xff, 0xfe]));
        Assert.Equal("AQ", Pkce.Base64Url([0x01]));
    }
}

public sealed class DeviceLinkTests
{
    [Fact]
    public void The_connect_url_encodes_the_device_name()
    {
        var url = DeviceLink.ConnectUrl(new Uri("https://boringtalks.lol"), "E9Melhoa2OwvFrEMTJguCHaoeKT8bCwXyGz8Qmm4l-I", "Mike's PC Pro & Co+ ü");
        Assert.Equal("https://boringtalks.lol/connect?challenge=E9Melhoa2OwvFrEMTJguCHaoeKT8bCwXyGz8Qmm4l-I&device=Mike%27s%20PC%20Pro%20%26%20Co%2B%20%C3%BC", url.AbsoluteUri);
    }

    [Fact]
    public void The_connect_url_on_the_dev_dashboard()
    {
        Assert.Equal("https://dev.boringtalks.lol/connect?challenge=abc&device=DESKTOP-4K2Q9",
            DeviceLink.ConnectUrl(new Uri("https://dev.boringtalks.lol/"), "abc", "DESKTOP-4K2Q9").AbsoluteUri);
    }

    [Fact]
    public void Reads_the_code_from_the_callback()
    {
        Assert.Equal("abc123", DeviceLink.CodeFromCallback("boringtalks://callback?code=abc123"));
        Assert.Equal("c/d", DeviceLink.CodeFromCallback("BoringTalks://Callback?state=x&code=c%2Fd"));
        Assert.Equal("abc", DeviceLink.CodeFromCallback("boringtalks://callback/?code=abc"));
    }

    [Theory]
    [InlineData("https://boringtalks.lol/callback?code=1", CallbackError.NotACallback)]
    [InlineData("boringtalks://other?code=1", CallbackError.NotACallback)]
    [InlineData("not a link", CallbackError.NotACallback)]
    [InlineData("boringtalks://callback", CallbackError.MissingCode)]
    [InlineData("boringtalks://callback?code=", CallbackError.MissingCode)]
    [InlineData("boringtalks://callback?error=access_denied", CallbackError.Denied)]
    public void Callback_errors(string link, CallbackError expected)
    {
        var error = Assert.Throws<CallbackException>(() => DeviceLink.CodeFromCallback(link));
        Assert.Equal(expected, error.Error);
    }

    [Fact]
    public void Callback_errors_say_what_happened()
    {
        Assert.Equal("Sign-in was cancelled (access_denied).", Assert.Throws<CallbackException>(() => DeviceLink.CodeFromCallback("boringtalks://callback?error=access_denied")).Message);
        Assert.Equal("That isn't a BoringTalks sign-in link.", new CallbackException(CallbackError.NotACallback).Message);
        Assert.Equal("The sign-in link has no code in it.", new CallbackException(CallbackError.MissingCode).Message);
    }

    [Fact]
    public void Reads_a_pasted_code()
    {
        Assert.Equal("abc123", DeviceLink.CodeFromPasted("  abc123\n"));
        Assert.Equal("xyz", DeviceLink.CodeFromPasted("boringtalks://callback?code=xyz"));
        Assert.Null(DeviceLink.CodeFromPasted(""));
        Assert.Null(DeviceLink.CodeFromPasted("two words"));
        Assert.Null(DeviceLink.CodeFromPasted(new string('x', 600)));
        Assert.Null(DeviceLink.CodeFromPasted("boringtalks://callback?error=denied"));
    }
}

/// <summary>A device-token endpoint that checks the verifier against the challenge it saw.</summary>
internal sealed class FakeDeviceApi : IDeviceAuthApi
{
    public string? ExpectedChallenge { get; set; }
    public List<DeviceTokenRequest> Requests { get; } = [];

    public Task<DeviceTokenResponse> ExchangeDeviceCodeAsync(DeviceTokenRequest request, CancellationToken cancellation = default)
    {
        Requests.Add(request);
        if (request.Code != "good-code" || Pkce.ChallengeFor(request.CodeVerifier) != ExpectedChallenge)
        {
            throw new ApiException(ApiErrorKind.Rejected, "Invalid code", 400);
        }
        return Task.FromResult(JsonSerializer.Deserialize<DeviceTokenResponse>(Fixture.Text("device-token-response"), ApiJson.Options)!);
    }
}

public sealed class DeviceAuthenticatorTests
{
    private static string Challenge(Uri url) =>
        url.Query.TrimStart('?').Split('&').Select(p => p.Split('=')).First(p => p[0] == "challenge")[1];

    private static readonly Uri Web = new("https://boringtalks.lol");

    [Fact]
    public async Task Signing_in_stores_the_token_and_forgets_the_verifier()
    {
        var api = new FakeDeviceApi();
        var store = new InMemorySecretStore();
        using var auth = new DeviceAuthenticator(api, store, "token");
        api.ExpectedChallenge = Challenge(auth.Begin(Web, "Test PC"));
        Assert.NotNull(store.Read("token.pending-verifier"));

        var credential = await auth.CompleteAsync("good-code", TestContext.Current.CancellationToken);
        Assert.Equal("btd_3q2+7w9yZx", credential.Token);
        Assert.Equal("mike@example.com", credential.Email);
        Assert.Equal("Mike", credential.Name);
        Assert.Equal("btd_3q2+7w9yZx", auth.Token());
        Assert.Null(store.Read("token.pending-verifier"));

        // A new launch reads it back from the store.
        using var relaunched = new DeviceAuthenticator(api, store, "token");
        Assert.Equal(credential, relaunched.Credential());
        relaunched.SignOut();
        Assert.Null(relaunched.Token());
        Assert.Null(store.Read("token"));
    }

    [Fact]
    public async Task A_callback_after_a_relaunch_uses_the_stored_verifier()
    {
        var api = new FakeDeviceApi();
        var store = new InMemorySecretStore();
        using (var first = new DeviceAuthenticator(api, store, "token")) api.ExpectedChallenge = Challenge(first.Begin(Web, "PC"));
        using var relaunched = new DeviceAuthenticator(api, store, "token");
        var credential = await relaunched.CompleteAsync("good-code", TestContext.Current.CancellationToken);
        Assert.Equal("c4d3b2a1-0f9e-4d8c-b7a6-958473625140", credential.DeviceId);
    }

    [Fact]
    public async Task Completing_without_beginning_fails()
    {
        using var auth = new DeviceAuthenticator(new FakeDeviceApi(), new InMemorySecretStore(), "token");
        var error = await Assert.ThrowsAsync<NoSignInInProgressException>(() => auth.CompleteAsync("good-code", TestContext.Current.CancellationToken));
        Assert.Contains("Sign in with browser", error.Message);
    }

    [Fact]
    public async Task A_rejected_code_keeps_the_user_signed_out()
    {
        var api = new FakeDeviceApi();
        using var auth = new DeviceAuthenticator(api, new InMemorySecretStore(), "token");
        api.ExpectedChallenge = Challenge(auth.Begin(Web, "PC"));
        var error = await Assert.ThrowsAsync<ApiException>(() => auth.CompleteAsync("stolen-code", TestContext.Current.CancellationToken));
        Assert.Equal(ApiErrorKind.Rejected, error.Kind);
        Assert.Null(auth.Token());
    }

    [Fact]
    public void A_damaged_stored_credential_reads_as_signed_out()
    {
        var store = new InMemorySecretStore();
        store.Write("token", "{broken"u8.ToArray());
        using var auth = new DeviceAuthenticator(new FakeDeviceApi(), store, "token");
        Assert.Null(auth.Credential());
    }
}

public sealed class AppConfigTests
{
    [Fact]
    public void Production_by_default()
    {
        var config = AppConfig.Resolve(["BoringTalks.exe"], null, null);
        Assert.Equal("https://api.boringtalks.lol/", config.ApiUrl.ToString());
        Assert.Equal("https://boringtalks.lol/", config.WebUrl.ToString());
        Assert.True(config.IsProduction);
        Assert.Equal("https://boringtalks.lol/meetings/abc", config.MeetingUrl("abc").ToString());
        Assert.Equal("https://boringtalks.lol/meetings", config.DashboardUrl.ToString());
    }

    [Fact]
    public void Settings_then_arguments_override()
    {
        var fromSettings = AppConfig.Resolve([], "https://api.dev.boringtalks.lol", "https://dev.boringtalks.lol");
        Assert.Equal("https://api.dev.boringtalks.lol/", fromSettings.ApiUrl.ToString());
        Assert.False(fromSettings.IsProduction);
        var fromArguments = AppConfig.Resolve(["x", "--api-url", "http://localhost:3001"], "https://api.dev.boringtalks.lol", "https://dev.boringtalks.lol");
        Assert.Equal("http://localhost:3001/", fromArguments.ApiUrl.ToString());
        Assert.Equal("https://dev.boringtalks.lol/", fromArguments.WebUrl.ToString());
    }

    [Fact]
    public void Invalid_urls_are_ignored()
    {
        var config = AppConfig.Resolve(["x", "--api-url", "not a url", "--web-url", "ftp://x.y", "--api-url"], "javascript:alert(1)", null);
        Assert.Equal(AppConfig.Production, config);
    }
}
