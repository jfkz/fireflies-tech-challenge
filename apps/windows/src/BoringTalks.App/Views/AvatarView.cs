using System.Windows;
using System.Windows.Media;
using BoringTalks.Core.Audio;

namespace BoringTalks.App.Views;

/// <summary>A head's colours and gear, from the web's <c>lib/avatar/styles.ts</c> (itself the Mac's <c>AvatarStyle</c>).</summary>
public sealed record AvatarStyle(Color Skin, Color Hair, Color Shirt, Color Accent, string HairCut, string Gear, string Badge, bool Beard = false, bool Lashes = false)
{
    private static Color Rgb(double r, double g, double b) => Color.FromRgb((byte)Math.Round(r * 255), (byte)Math.Round(g * 255), (byte)Math.Round(b * 255));

    /// <summary>Speaks into the microphone: "You".</summary>
    public static AvatarStyle Talker { get; } = new(Rgb(0.91, 0.7, 0.54), Rgb(0.25, 0.17, 0.13), Rgb(1.0, 0.52, 0.24), Rgb(0.2, 0.22, 0.29), "spiky", "headset", "mic");

    /// <summary>Listens to what the PC plays: everyone else.</summary>
    public static AvatarStyle Listener { get; } = new(Rgb(0.98, 0.8, 0.67), Rgb(0.16, 0.7, 0.64), Rgb(0.36, 0.42, 1.0), Rgb(1.0, 0.82, 0.25), "bob", "headphones", "speaker");
}

/// <summary>
/// A cartoon head drawn in a 200×200 design space, the same drawing as the web's
/// <c>components/avatar/Avatar.tsx</c> and the Mac's <c>AvatarView</c>: it blinks, glances, and
/// moves its mouth with the loudness of its side of the call.
/// </summary>
public sealed class AvatarView : FrameworkElement
{
    private static readonly Color InkColor = Color.FromRgb(0x29, 0x21, 0x33);
    private static readonly Brush InkBrush = Frozen(new SolidColorBrush(InkColor));
    private static readonly Brush White = Frozen(new SolidColorBrush(Colors.White));
    private static readonly Brush MouthBrush = Frozen(new SolidColorBrush(Color.FromRgb(0x5c, 0x1a, 0x2e)));
    private static readonly Brush Tongue = Frozen(new SolidColorBrush(Color.FromRgb(0xff, 0x78, 0x87)));
    private static readonly Pen Line = Frozen(new Pen(InkBrush, 3.2) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round, LineJoin = PenLineJoin.Round });
    private static readonly Pen Thin = Frozen(new Pen(InkBrush, 2.5) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round });

    private static readonly Dictionary<string, Geometry> Fringes = new()
    {
        ["bob"] = Geometry.Parse("M45 96C38 50 66 28 100 28C134 28 162 50 155 96Q150 66 132 62Q118 72 104 66Q92 54 76 58Q52 64 45 96Z"),
        ["long"] = Geometry.Parse("M45 96C38 50 66 28 100 28C134 28 162 50 155 96Q150 66 132 62Q118 72 104 66Q92 54 76 58Q52 64 45 96Z"),
        ["short"] = Geometry.Parse("M46 90C38 46 64 26 100 26C136 26 162 46 154 90Q152 62 140 58Q100 46 64 56Q50 62 46 90Z"),
        ["spiky"] = Geometry.Parse("M46 86L40 62L56 60L52 40L72 44L76 22L94 36L108 16L116 38L136 28L136 48L156 48L154 86Q146 60 120 58Q100 68 78 60Q54 60 46 86Z"),
    };

    private readonly Random random = new();
    private double mouth;
    private double blink;
    private double look;
    private double brow;
    private DateTime nextBlink = DateTime.Now.AddSeconds(2);
    private DateTime nextGlance = DateTime.Now.AddSeconds(3);
    private double glanceTarget;

    public AvatarView()
    {
        CompositionTarget.Rendering += (_, _) => Animate();
    }

    public AvatarStyle Look { get; set; } = AvatarStyle.Listener;

    /// <summary>The side of the call whose loudness moves the mouth.</summary>
    public LevelMeter? Meter { get; set; }

    /// <summary>Seconds since this side last got words; recent words keep the brows up.</summary>
    public Func<double>? SinceSpeech { get; set; }

    private static T Frozen<T>(T freezable) where T : Freezable
    {
        freezable.Freeze();
        return freezable;
    }

    private void Animate()
    {
        if (!IsVisible) return;
        var now = DateTime.Now;
        var level = Meter?.Read() ?? default;
        // The mouth follows the syllables while something plays, and closes in silence.
        var target = level.SinceSound < 0.3 ? Math.Clamp(level.Syllable * 1.1 + level.Level * 0.25, 0, 1) : 0;
        mouth += (target - mouth) * 0.45;
        brow += ((SinceSpeech?.Invoke() ?? 1000) < 1.5 || target > 0.2 ? 4 - brow : -brow) * 0.15;
        if (now >= nextBlink)
        {
            blink = 1;
            nextBlink = now.AddSeconds(2 + random.NextDouble() * 4);
        }
        blink = Math.Max(0, blink - 0.18);
        if (now >= nextGlance)
        {
            glanceTarget = random.NextDouble() < 0.5 ? 0 : random.NextDouble() * 2 - 1;
            nextGlance = now.AddSeconds(1.5 + random.NextDouble() * 3);
        }
        look += (glanceTarget - look) * 0.12;
        InvalidateVisual();
    }

    protected override void OnRender(DrawingContext drawingContext)
    {
        var dc = drawingContext;
        var size = Math.Min(ActualWidth, ActualHeight);
        if (size <= 0) return;
        var style = Look;
        dc.PushTransform(new TranslateTransform((ActualWidth - size) / 2, (ActualHeight - size) / 2));
        dc.PushTransform(new ScaleTransform(size / 200, size / 200));
        dc.PushClip(new RectangleGeometry(new Rect(0, 0, 200, 200)));

        Brush Fill(Color c) => new SolidColorBrush(c);
        var skin = Fill(style.Skin);
        var hair = Fill(style.Hair);
        var bob = mouth * 1.5;

        // Body.
        if (style.HairCut == "long") dc.DrawRoundedRectangle(hair, Line, new Rect(32, 30 + bob, 136, 152), 56, 56);
        dc.DrawRoundedRectangle(Fill(style.Shirt), Line, new Rect(30, 160 + bob * 0.3, 140, 90), 50, 50);
        DrawBadge(dc, style, 186 + bob * 0.3);
        dc.DrawRoundedRectangle(skin, Line, new Rect(86, 128, 28, 40), 9, 9);

        // Head.
        dc.PushTransform(new TranslateTransform(0, bob));
        if (style.HairCut == "bob") dc.DrawEllipse(hair, Line, new Point(100, 92), 66, 66);
        foreach (var x in new[] { 46.0, 154 }) dc.DrawEllipse(skin, Line, new Point(x, 102), 13, 14);
        var face = new EllipseGeometry(new Point(100, 95), 56, 61);
        dc.DrawGeometry(skin, Line, face);
        if (style.Beard)
        {
            dc.PushClip(face);
            dc.DrawGeometry(hair, null, Geometry.Parse("M46 100Q50 160 100 162Q150 160 154 100Q136 118 100 118Q64 118 46 100Z"));
            dc.Pop();
            dc.DrawGeometry(null, Line, face);
        }
        dc.DrawGeometry(hair, Line, Fringes[style.HairCut]);
        DrawFace(dc, style, skin);
        DrawGear(dc, style);
        dc.Pop();

        dc.Pop();
        dc.Pop();
        dc.Pop();
    }

    private void DrawFace(DrawingContext dc, AvatarStyle style, Brush skin)
    {
        // Brows, raised while talking.
        foreach (var (x, side) in new[] { (78.0, -1.0), (122.0, 1.0) })
        {
            dc.PushTransform(new TranslateTransform(x, 75 - brow));
            dc.PushTransform(new RotateTransform(side * 0.14 * 180 / Math.PI));
            dc.DrawRoundedRectangle(InkBrush, null, new Rect(-12, -3, 24, 6), 3, 3);
            dc.Pop();
            dc.Pop();
        }
        // Eyes: shut mid-blink, else white with a pupil that glances about.
        var open = 1 - blink;
        foreach (var x in new[] { 78.0, 122 })
        {
            if (open < 0.2)
            {
                dc.DrawGeometry(null, Line, Geometry.Parse(FormattableString.Invariant($"M{x - 10} 97Q{x} 102 {x + 10} 97")));
                continue;
            }
            var height = 26 * open;
            var eye = new EllipseGeometry(new Point(x, 97), 11, height / 2);
            dc.DrawGeometry(White, null, eye);
            dc.PushClip(eye);
            dc.DrawEllipse(InkBrush, null, new Point(x + look * 3.5, 100), 7.5, 8);
            dc.DrawEllipse(White, null, new Point(x + look * 3.5 + 1.5, 96.5), 2.5, 2.5);
            dc.Pop();
            dc.DrawGeometry(null, Thin, eye);
            if (style.Lashes)
            {
                var outer = x < 100 ? -1 : 1;
                var top = 97 - height / 2;
                foreach (var (dx, dy) in new[] { (9.0, -9.0), (12.0, -4.0) })
                {
                    var fx = x + outer * (dx - 2);
                    var fy = top + (dy + 9) * 0.6;
                    dc.DrawLine(Thin, new Point(fx, fy), new Point(fx + outer * 5, fy - 4));
                }
            }
        }
        // Cheeks and nose.
        if (!style.Beard)
        {
            var blush = new SolidColorBrush(Color.FromArgb((byte)(0.35 * 255), 255, 115, 128));
            foreach (var x in new[] { 66.0, 134 }) dc.DrawEllipse(blush, null, new Point(x, 117.5), 10, 5.5);
        }
        dc.DrawGeometry(null, new Pen(new SolidColorBrush(Color.FromArgb(178, InkColor.R, InkColor.G, InkColor.B)), 2.6) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round },
            Geometry.Parse("M96 111Q100 117 104 111"));
        DrawMouth(dc);
    }

    private void DrawMouth(DrawingContext dc)
    {
        var m = mouth;
        if (m < 0.06)
        {
            // Closed: a gentle smile.
            dc.DrawGeometry(null, Line, Geometry.Parse("M87 127Q100 138 113 127"));
            return;
        }
        // Talking: a soft upper lip and a rounder lower one. Teeth show only when it opens wide.
        var width = 24 - 5 * m;
        var height = 3 + 17 * m;
        const double top = 125;
        var corner = top + height * 0.25 - 2.2;
        double lx = 100 - width / 2, rx = 100 + width / 2;
        var shape = Geometry.Parse(FormattableString.Invariant(
            $"M{lx:0.##} {corner:0.##}Q100 {top - height * 0.3:0.##} {rx:0.##} {corner:0.##}C{rx - width * 0.1:0.##} {top + height * 1.12:0.##} {lx + width * 0.1:0.##} {top + height * 1.12:0.##} {lx:0.##} {corner:0.##}Z"));
        dc.DrawGeometry(MouthBrush, null, shape);
        dc.PushClip(shape);
        dc.DrawEllipse(Tongue, null, new Point(100, top + height * 0.6), width * 0.3, height * 0.3);
        if (m > 0.35)
        {
            dc.PushOpacity(Math.Min(1, (m - 0.35) / 0.15));
            dc.DrawRectangle(White, null, new Rect(100 - width / 2, top - height, width, height + Math.Min(3.5, height * 0.2)));
            dc.Pop();
        }
        dc.Pop();
        dc.DrawGeometry(null, new Pen(InkBrush, 2.4) { LineJoin = PenLineJoin.Round }, shape);
    }

    private static void DrawGear(DrawingContext dc, AvatarStyle style)
    {
        var accent = new SolidColorBrush(style.Accent);
        if (style.Gear == "headphones")
        {
            var band = Geometry.Parse("M38.18 79.44A64 64 0 0 1 161.82 79.44");
            dc.DrawGeometry(null, new Pen(InkBrush, 9) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round }, band);
            dc.DrawGeometry(null, new Pen(accent, 3) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round }, band);
            foreach (var x in new[] { 40.0, 160 }) dc.DrawRoundedRectangle(accent, Line, new Rect(x - 11, 80, 22, 40), 10, 10);
        }
        else if (style.Gear == "headset")
        {
            dc.DrawEllipse(accent, Line, new Point(155, 102), 10, 11);
            dc.DrawGeometry(null, new Pen(InkBrush, 4) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round }, Geometry.Parse("M152 112Q150 140 126 138"));
            dc.DrawRoundedRectangle(accent, new Pen(InkBrush, 2.2), new Rect(114, 132, 15, 11), 5.5, 5.5);
        }
    }

    private static void DrawBadge(DrawingContext dc, AvatarStyle style, double y)
    {
        var color = new SolidColorBrush(style.Shirt);
        dc.PushTransform(new TranslateTransform(100, y));
        dc.DrawEllipse(new SolidColorBrush(Color.FromArgb(230, 255, 255, 255)), null, new Point(0, 0), 15, 15);
        var pen = new Pen(color, 2.4) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round };
        if (style.Badge == "mic")
        {
            dc.DrawRoundedRectangle(color, null, new Rect(-3.5, -9, 7, 11), 3.5, 3.5);
            dc.DrawGeometry(null, pen, Geometry.Parse("M-6.5 -1.5Q-6.5 6 0 6Q6.5 6 6.5 -1.5M0 6V9.5"));
        }
        else
        {
            dc.DrawGeometry(color, null, Geometry.Parse("M-9 -3.5H-5L1 -8.5V8.5L-5 3.5H-9Z"));
            dc.DrawGeometry(null, new Pen(color, 2.2) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round }, Geometry.Parse("M4 -4Q7 0 4 4M7 -7Q12 0 7 7"));
        }
        dc.Pop();
    }
}
