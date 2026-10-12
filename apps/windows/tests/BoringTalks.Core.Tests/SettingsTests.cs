using System.Text.Json;
using BoringTalks.Core.Api;
using BoringTalks.Core.Speech;

namespace BoringTalks.Core.Tests;

public sealed class SettingsTests
{
    [Fact]
    public void Defaults_match_the_mac_app()
    {
        var settings = new Settings();
        Assert.Equal("", settings.Language);
        Assert.Null(settings.LanguageCode);
        Assert.True(settings.UploadAudio);
        Assert.Equal(7, settings.KeepAudioDays);
        Assert.True(settings.AvoidBluetoothMic);
        Assert.Equal(5, settings.SilenceStopMinutes);
        Assert.True(settings.OfferToRecordCalls);
        Assert.True(settings.StopWhenCallEnds);
        Assert.Empty(settings.IgnoredCallApps);
        Assert.True(settings.OpenAtSignIn);
        Assert.Equal("de", (settings with { Language = "de" }).LanguageCode);
    }

    [Fact]
    public void Round_trips_through_the_json_file()
    {
        using var folder = new TemporaryFolder();
        var store = new JsonSettingsStore(Path.Combine(folder.Path, "nested", "settings.json"));
        Assert.Equal(new Settings().KeepAudioDays, store.Load().KeepAudioDays);
        var changed = new Settings { Language = "de", KeepAudioDays = 30, IgnoredCallApps = ["Chrome"], ApiUrl = "https://api.dev.boringtalks.lol" };
        store.Save(changed);
        var loaded = store.Load();
        Assert.Equal("de", loaded.Language);
        Assert.Equal(30, loaded.KeepAudioDays);
        Assert.Equal(["Chrome"], loaded.IgnoredCallApps);
        Assert.Equal("https://api.dev.boringtalks.lol", loaded.ApiUrl);
        Assert.Contains("\"keepAudioDays\": 30", File.ReadAllText(store.Path));
    }

    [Fact]
    public void Hand_edited_files_are_read_leniently()
    {
        using var folder = new TemporaryFolder();
        var path = folder.File("settings.json");
        File.WriteAllText(path, """{ "apiUrl": "https://api.dev.boringtalks.lol", "keepAudioDays": -3, "extraCallApps": ["huddle.exe"], "ignoredCallApps": null }""");
        var loaded = new JsonSettingsStore(path).Load();
        Assert.Equal("https://api.dev.boringtalks.lol", loaded.ApiUrl);
        Assert.Equal(0, loaded.KeepAudioDays);
        Assert.Equal(["huddle.exe"], loaded.ExtraCallApps);
        Assert.Empty(loaded.IgnoredCallApps);
        Assert.True(loaded.UploadAudio);

        File.WriteAllText(path, "{oops");
        Assert.Equal(5, new JsonSettingsStore(path).Load().SilenceStopMinutes);
    }

    [Fact]
    public void Silence_choices_include_a_value_set_by_hand()
    {
        Assert.Equal([1, 2, 5, 10, 15, 30, 60], Settings.SilenceChoices(5));
        Assert.Equal([1, 2, 3, 5, 10, 15, 30, 60], Settings.SilenceChoices(3));
        Assert.Equal([1, 2, 5, 10, 15, 30, 60], Settings.SilenceChoices(0));
    }

    [Fact]
    public void Folders_live_under_appdata()
    {
        var folders = new AppFolders(@"C:\Users\me\AppData\Roaming\BoringTalks", @"C:\Users\me\AppData\Local\BoringTalks\models");
        Assert.Equal(@"C:\Users\me\AppData\Roaming\BoringTalks\Recordings", folders.Recordings);
        Assert.Equal(@"C:\Users\me\AppData\Roaming\BoringTalks\uploads.json", folders.UploadQueue);
        Assert.Equal(@"C:\Users\me\AppData\Roaming\BoringTalks\settings.json", folders.Settings);
        Assert.Equal(@"C:\Users\me\AppData\Roaming\BoringTalks\logs", folders.Logs);
        Assert.Equal(@"C:\Users\me\AppData\Local\BoringTalks\models", folders.Models);
        Assert.EndsWith("BoringTalks", AppFolders.Standard.Root);

        using var temp = new TemporaryFolder();
        var made = new AppFolders(Path.Combine(temp.Path, "root"), Path.Combine(temp.Path, "models"));
        made.Create();
        Assert.True(Directory.Exists(made.Recordings));
        Assert.True(Directory.Exists(made.Models));
    }
}

public sealed class ModelCatalogTests
{
    [Fact]
    public void Lists_parakeet_and_the_voice_models_with_mirrors()
    {
        Assert.Equal(4, ModelCatalog.Speech.Count);
        Assert.Contains(ModelCatalog.Speech, f => f.RelativePath == "parakeet-tdt-0.6b-v3-int8/encoder.int8.onnx");
        Assert.All(ModelCatalog.Speech.Concat(ModelCatalog.Voices), f =>
        {
            Assert.Equal("download.boringtalks.lol", f.Urls[0].Host);
            Assert.True(f.Urls.Count >= 2);
        });
        Assert.InRange(ModelCatalog.ApproximateBytes, 700_000_000, 730_000_000);
        Assert.Equal(@"C:\m\parakeet-tdt-0.6b-v3-int8\tokens.txt", ModelCatalog.PathOf(ModelCatalog.Speech[3], @"C:\m"));
    }

    [Fact]
    public void A_file_counts_once_it_is_all_there()
    {
        using var folder = new TemporaryFolder();
        var pinned = new ModelFile("m/a.onnx", [new Uri("https://x.test/a")], 1000);
        var unpinned = new ModelFile("m/tokens.txt", [new Uri("https://x.test/t")], 0);
        Assert.False(ModelCatalog.IsPresent(pinned, folder.Path));
        Directory.CreateDirectory(folder.File("m"));
        File.WriteAllBytes(folder.File(@"m\a.onnx"), new byte[500]);
        File.WriteAllBytes(folder.File(@"m\tokens.txt"), new byte[3]);
        Assert.False(ModelCatalog.IsPresent(pinned, folder.Path));
        Assert.True(ModelCatalog.IsPresent(unpinned, folder.Path));
        File.WriteAllBytes(folder.File(@"m\a.onnx"), new byte[1000]);
        Assert.True(ModelCatalog.IsPresent(pinned, folder.Path));
    }
}

/// <summary>The fixtures shared with packages/shared decode into the C# mirrors of the contract.</summary>
public sealed class ContractFixtureTests
{
    private static T Read<T>(string name) => JsonSerializer.Deserialize<T>(Fixture.Text(name), ApiJson.Options)!;

    [Fact]
    public void Every_fixture_decodes()
    {
        Assert.Equal("0b9a1e8e-2f4c-4d3a-9b8e-1c2d3e4f5a6b", Read<CreatedMeeting>("created-meeting").Id);
        Assert.StartsWith("btd_", Read<DeviceTokenResponse>("device-token-response").Token);
        Assert.Equal("Validation failed", Read<ApiErrorBody>("error-400").Message);
        Assert.Equal(2, Read<MeetingPage>("meeting-page").Items.Count);
        Assert.Equal(2, Read<TranscriptUpload>("transcript-upload").Segments.Count);
        Assert.Equal(900, Read<UploadUrlResponse>("upload-url-response").ExpiresInSec);
    }

    [Fact]
    public void The_windows_download_manifest_names_the_installer() =>
        Assert.EndsWith(".exe", (string?)Fixture.Json("latest-windows")["url"], StringComparison.Ordinal);
}
