using System.Security.Cryptography;
using System.Text;

namespace BoringTalks.Core.Auth;

/// <summary>
/// Proof Key for Code Exchange (RFC 7636, S256): the app keeps the verifier, the
/// browser only ever sees its hash, so a code caught on the way back is useless
/// to anyone else.
/// </summary>
public sealed record Pkce(string Verifier)
{
    public string Challenge { get; } = ChallengeFor(Verifier);

    /// <summary>A fresh pair from 32 random bytes (a 43-character verifier).</summary>
    public static Pkce Generate() => new(Base64Url(RandomNumberGenerator.GetBytes(32)));

    public static string ChallengeFor(string verifier) => Base64Url(SHA256.HashData(Encoding.UTF8.GetBytes(verifier)));

    /// <summary>base64url without padding.</summary>
    public static string Base64Url(ReadOnlySpan<byte> data) =>
        Convert.ToBase64String(data).Replace('+', '-').Replace('/', '_').TrimEnd('=');
}
