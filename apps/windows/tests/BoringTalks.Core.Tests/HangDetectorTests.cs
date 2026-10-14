namespace BoringTalks.Core.Tests;

public sealed class HangDetectorTests
{
    private readonly HangDetector detector = new(10);

    [Fact]
    public void Pings_when_nothing_is_waiting()
    {
        Assert.Equal((true, (HangEvent?)null), detector.Tick(0));
        Assert.Equal((false, (HangEvent?)null), detector.Tick(1));
        Assert.Null(detector.Answered(1.2));
        Assert.Equal((true, (HangEvent?)null), detector.Tick(2));
    }

    [Fact]
    public void Says_once_that_the_UI_thread_is_stuck_then_how_long_it_was()
    {
        // The watchdog ticks every second; nothing answers from 100 on.
        var events = Enumerable.Range(100, 151).Select(t => detector.Tick(t)).ToList();
        Assert.True(events[0].Ping);
        Assert.All(events.Skip(1), e => Assert.False(e.Ping));
        Assert.Equal([new HangEvent.Stalled(100, 10)], events.Select(e => e.Event).OfType<HangEvent>());
        Assert.Equal(new HangEvent.Recovered(150), detector.Answered(250));
        // The next hang is reported again.
        detector.Tick(251);
        Assert.IsType<HangEvent.Stalled>(Enumerable.Range(252, 10).Select(t => detector.Tick(t)).ToList()[^1].Event);
    }

    [Fact]
    public void Does_not_count_the_PC_sleeping()
    {
        detector.Tick(0);
        detector.Tick(1);
        // Asleep from 1 to 3601: the watchdog didn't tick, and the UI thread didn't run either.
        Assert.Equal((false, (HangEvent?)null), detector.Tick(3601));
        Assert.Null(detector.Answered(3602));
    }

    [Fact]
    public void Ignores_an_answer_without_a_ping()
    {
        Assert.Null(detector.Answered(5));
        Assert.Equal(10, detector.Threshold);
    }
}
