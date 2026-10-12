using System.Text;
using System.Text.Json;
using BoringTalks.Core.Api;

namespace BoringTalks.Core.Auth;

/// <summary>Where secrets go: Windows Credential Manager in the app, a dictionary in tests.</summary>
public interface ISecretStore
{
    byte[]? Read(string account);
    void Write(string account, byte[] data);
    void Delete(string account);
}

public sealed class InMemorySecretStore : ISecretStore
{
    private readonly Dictionary<string, byte[]> items = [];
    private readonly Lock gate = new();

    public byte[]? Read(string account)
    {
        lock (gate) return items.TryGetValue(account, out var data) ? data : null;
    }

    public void Write(string account, byte[] data)
    {
        lock (gate) items[account] = data;
    }

    public void Delete(string account)
    {
        lock (gate) items.Remove(account);
    }
}

/// <summary>What the credential store keeps for a signed-in PC.</summary>
public sealed record DeviceCredential(string Token, string DeviceId, string? Email, string? Name);

/// <summary>Signs this PC in with PKCE and keeps its device token in the credential store.</summary>
public sealed class DeviceAuthenticator : IDisposable
{
    private readonly IDeviceAuthApi api;
    private readonly ISecretStore store;
    private readonly string account;
    private readonly SemaphoreSlim gate = new(1, 1);
    private Pkce? pending;
    private DeviceCredential? cached;
    private bool loaded;

    /// <param name="account">Names the stored item; one per API host, so dev and prod sign-ins don't overwrite each other.</param>
    public DeviceAuthenticator(IDeviceAuthApi api, ISecretStore store, string account)
    {
        this.api = api;
        this.store = store;
        this.account = account;
    }

    private string PendingAccount => $"{account}.pending-verifier";

    /// <summary>Starts a sign-in: remembers a fresh verifier and returns the page to open.</summary>
    public Uri Begin(Uri webUrl, string deviceName)
    {
        var pkce = Pkce.Generate();
        lock (store)
        {
            pending = pkce;
            // Survives a relaunch between opening the browser and the callback.
            TryStore(() => store.Write(PendingAccount, Encoding.UTF8.GetBytes(pkce.Verifier)));
        }
        return DeviceLink.ConnectUrl(webUrl, pkce.Challenge, deviceName);
    }

    /// <summary>Swaps the one-time code for the device token and stores it.</summary>
    public async Task<DeviceCredential> CompleteAsync(string code, CancellationToken cancellation = default)
    {
        await gate.WaitAsync(cancellation);
        try
        {
            string? verifier;
            lock (store) verifier = pending?.Verifier ?? Decode(store.Read(PendingAccount));
            if (verifier is null) throw new NoSignInInProgressException();
            var response = await api.ExchangeDeviceCodeAsync(new DeviceTokenRequest(code, verifier), cancellation);
            var credential = new DeviceCredential(response.Token, response.DeviceId, response.User.Email, response.User.Name);
            lock (store)
            {
                store.Write(account, JsonSerializer.SerializeToUtf8Bytes(credential, ApiJson.Options));
                TryStore(() => store.Delete(PendingAccount));
                pending = null;
                cached = credential;
                loaded = true;
            }
            return credential;
        }
        finally
        {
            gate.Release();
        }
    }

    public DeviceCredential? Credential()
    {
        lock (store)
        {
            if (!loaded)
            {
                loaded = true;
                try
                {
                    var data = store.Read(account);
                    cached = data is null ? null : JsonSerializer.Deserialize<DeviceCredential>(data, ApiJson.Options);
                }
                catch (Exception error) when (error is JsonException or IOException or InvalidOperationException)
                {
                    cached = null;
                }
            }
            return cached;
        }
    }

    public string? Token() => Credential()?.Token;

    public void SignOut()
    {
        lock (store)
        {
            TryStore(() => store.Delete(account));
            TryStore(() => store.Delete(PendingAccount));
            cached = null;
            pending = null;
            loaded = true;
        }
    }

    public void Dispose() => gate.Dispose();

    private static string? Decode(byte[]? data) => data is null ? null : Encoding.UTF8.GetString(data);

    private static void TryStore(Action action)
    {
        try
        {
            action();
        }
        catch (Exception error) when (error is IOException or InvalidOperationException or UnauthorizedAccessException)
        {
            // Losing the pending verifier only means starting the sign-in again.
        }
    }
}

public sealed class NoSignInInProgressException()
    : Exception("Start with “Sign in with browser” first, then use the link or code it gives you.");
