using System.Net.Http.Headers;
using System.Security.Cryptography;
using BoringTalks.Core.Speech;

namespace BoringTalks.Speech;

/// <summary>
/// Downloads the model files into the models folder: from the first mirror that answers,
/// resuming a partial download, and checking the size and SHA-256 before a file counts.
/// </summary>
public sealed class ModelStore(string folder, HttpClient http, Action<string>? log = null)
{
    public string Folder { get; } = folder;

    public bool HasAll(IEnumerable<ModelFile> files) => files.All(f => ModelCatalog.IsPresent(f, Folder));

    /// <summary>Gets every missing file; <paramref name="progress"/> receives 0…1 over all of them.</summary>
    public async Task EnsureAsync(IReadOnlyList<ModelFile> files, IProgress<double>? progress = null, CancellationToken cancellation = default)
    {
        var total = Math.Max(1, files.Sum(f => f.SizeBytes));
        long done = 0;
        foreach (var file in files)
        {
            if (!ModelCatalog.IsPresent(file, Folder))
            {
                var before = done;
                await DownloadAsync(file, new Progress<long>(bytes => progress?.Report(Math.Min(1, (double)(before + bytes) / total))), cancellation);
            }
            done += file.SizeBytes;
            progress?.Report(Math.Min(1, (double)done / total));
        }
    }

    private async Task DownloadAsync(ModelFile file, IProgress<long> progress, CancellationToken cancellation)
    {
        var path = ModelCatalog.PathOf(file, Folder);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var partial = path + ".part";
        Exception? last = null;
        foreach (var url in file.Urls)
        {
            try
            {
                await FetchAsync(url, partial, progress, cancellation);
                if (file.SizeBytes > 0 && new FileInfo(partial).Length != file.SizeBytes)
                {
                    throw new InvalidDataException($"{Path.GetFileName(path)} is {new FileInfo(partial).Length} bytes, expected {file.SizeBytes}.");
                }
                if (file.Sha256 is { } expected && !string.Equals(await HashAsync(partial, cancellation), expected, StringComparison.OrdinalIgnoreCase))
                {
                    File.Delete(partial);
                    throw new InvalidDataException($"{Path.GetFileName(path)} is damaged (checksum mismatch).");
                }
                File.Move(partial, path, overwrite: true);
                log?.Invoke($"downloaded {file.RelativePath} from {url.Host}");
                return;
            }
            catch (Exception error) when (error is HttpRequestException or IOException or InvalidDataException && !cancellation.IsCancellationRequested)
            {
                log?.Invoke($"couldn't get {file.RelativePath} from {url.Host}: {error.Message}");
                last = error;
            }
        }
        throw new IOException($"Couldn't download {Path.GetFileName(path)}: {last?.Message}", last);
    }

    private async Task FetchAsync(Uri url, string partial, IProgress<long> progress, CancellationToken cancellation)
    {
        var have = File.Exists(partial) ? new FileInfo(partial).Length : 0;
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (have > 0) request.Headers.Range = new RangeHeaderValue(have, null);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellation);
        if (response.StatusCode == System.Net.HttpStatusCode.RequestedRangeNotSatisfiable)
        {
            // Already complete (or the mirror changed): start over.
            File.Delete(partial);
            throw new IOException("The partial download didn't match; starting over.");
        }
        response.EnsureSuccessStatusCode();
        var resuming = have > 0 && response.StatusCode == System.Net.HttpStatusCode.PartialContent;
        if (!resuming) have = 0;
        await using var source = await response.Content.ReadAsStreamAsync(cancellation);
        await using var target = new FileStream(partial, resuming ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16, useAsync: true);
        var buffer = new byte[1 << 16];
        var reported = DateTime.UtcNow;
        int read;
        while ((read = await source.ReadAsync(buffer, cancellation)) > 0)
        {
            await target.WriteAsync(buffer.AsMemory(0, read), cancellation);
            have += read;
            if (DateTime.UtcNow - reported > TimeSpan.FromMilliseconds(200))
            {
                progress.Report(have);
                reported = DateTime.UtcNow;
            }
        }
        progress.Report(have);
    }

    private static async Task<string> HashAsync(string path, CancellationToken cancellation)
    {
        await using var stream = File.OpenRead(path);
        return Convert.ToHexStringLower(await SHA256.HashDataAsync(stream, cancellation));
    }
}
