using BoringTalks.Core.Calls;

namespace BoringTalks.Core.Tests;

public sealed class GameDetectorTests
{
    private static readonly HashSet<string> Recognised = new(StringComparer.OrdinalIgnoreCase) { @"C:\Games\common\Among Us\Among Us.exe", @"E:\Odd\place\MyGame.exe" };

    [Theory]
    [InlineData(@"D:\Games\steamapps\common\Cyberpunk 2077\bin\x64\Cyberpunk2077.exe", "Cyberpunk 2077")]
    [InlineData(@"C:\Program Files (x86)\Steam\steamapps\common\Super Bunny Man\Super Bunny Man.exe", "Super Bunny Man")]
    [InlineData(@"C:\Program Files\Epic Games\Fortnite\FortniteGame\Binaries\Win64\FortniteClient-Win64-Shipping.exe", "Fortnite")]
    [InlineData(@"C:\XboxGames\Forza Horizon 5\Content\ForzaHorizon5.exe", "Forza Horizon 5")]
    [InlineData(@"C:\Riot Games\VALORANT\live\VALORANT.exe", "VALORANT")]
    [InlineData(@"C:\Games\common\Among Us\Among Us.exe", "Among Us")]
    [InlineData(@"E:\Odd\place\MyGame.exe", "MyGame")]
    public void Finds_games(string path, string name) => Assert.Equal(name, GameDetector.GameName(path, Recognised));

    [Theory]
    [InlineData(@"C:\Program Files (x86)\Steam\steam.exe")]
    [InlineData(@"C:\Program Files (x86)\Steam\steamapps\common\Steamworks Shared\_CommonRedist\vcredist\2019\VC_redist.x64.exe")]
    [InlineData(@"D:\Games\steamapps\common\Stray\Engine\Binaries\Win64\CrashReportClient.exe")]
    [InlineData(@"C:\Program Files (x86)\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe")]
    [InlineData(@"C:\Program Files (x86)\EasyAntiCheat\EasyAntiCheat.exe")]
    [InlineData(@"C:\Riot Games\Riot Client\RiotClientServices.exe")]
    [InlineData(@"C:\Program Files\Zoom\bin\Zoom.exe")]
    [InlineData(@"C:\Windows\explorer.exe")]
    [InlineData("")]
    [InlineData(@"D:\Games\steamapps\common\Game\readme.txt")]
    public void Ignores_the_rest(string path) => Assert.Null(GameDetector.GameName(path, Recognised));
}

public sealed class GameWatchTests
{
    [Fact]
    public void A_game_starts_after_running_a_while_and_ends_after_being_gone_a_while()
    {
        var watch = new GameWatch();
        Assert.Empty(watch.Update(["Stray"], 0));
        Assert.Empty(watch.Update(["Stray"], 5));
        Assert.Equal([new GameEvent.Started("Stray")], watch.Update(["Stray"], 10));
        Assert.Equal(["Stray"], watch.Running);
        Assert.Empty(watch.Update(["Stray"], 60));
        // Gone briefly (it restarted into another executable): still running.
        Assert.Empty(watch.Update([], 65));
        Assert.Empty(watch.Update(["Stray"], 70));
        Assert.Empty(watch.Update([], 75));
        Assert.Empty(watch.Update([], 90));
        Assert.Equal([new GameEvent.Ended("Stray")], watch.Update([], 95));
        Assert.Empty(watch.Running);
    }

    [Fact]
    public void A_blip_never_counts()
    {
        var watch = new GameWatch();
        Assert.Empty(watch.Update(["Launcher thing"], 0));
        Assert.Empty(watch.Update([], 4));
        Assert.Empty(watch.Update(["Launcher thing"], 30));
        Assert.Empty(watch.Update(["Launcher thing"], 35));
        Assert.Equal([new GameEvent.Started("Launcher thing")], watch.Update(["Launcher thing"], 40));
    }

    [Fact]
    public void Names_are_compared_without_case()
    {
        var watch = new GameWatch();
        watch.Update(["VALORANT"], 0);
        Assert.Equal([new GameEvent.Started("VALORANT")], watch.Update(["valorant"], 10));
    }
}
