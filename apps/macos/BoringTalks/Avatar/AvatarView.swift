import SwiftUI

// The cartoon head, without emotions and music: it blinks,
// bobs, and its mouth opens on each syllable while its words come in. BoringTalks
// adds a sleepy face for the icon.

struct AvatarStyle {
    enum Hair { case bob, short, spiky }
    enum Gear { case headphones, headset }

    var skin: Color
    var hair: Color
    var shirt: Color
    var accent: Color
    var hairCut: Hair
    var gear: Gear
    var badge: String

    /// The other people on the call (system audio).
    static let listener = AvatarStyle(
        skin: Color(red: 0.98, green: 0.80, blue: 0.67),
        hair: Color(red: 0.16, green: 0.70, blue: 0.64),
        shirt: Color(red: 0.36, green: 0.42, blue: 1.00),
        accent: Color(red: 1.00, green: 0.82, blue: 0.25),
        hairCut: .bob,
        gear: .headphones,
        badge: "speaker.wave.2.fill"
    )

    /// You (the microphone).
    static let talker = AvatarStyle(
        skin: Color(red: 0.91, green: 0.70, blue: 0.54),
        hair: Color(red: 0.25, green: 0.17, blue: 0.13),
        shirt: Color(red: 1.00, green: 0.52, blue: 0.24),
        accent: Color(red: 0.20, green: 0.22, blue: 0.29),
        hairCut: .spiky,
        gear: .headset,
        badge: "mic.fill"
    )

    static let ink = Color(red: 0.16, green: 0.13, blue: 0.20)
}

struct AvatarPose {
    var time: Double = 0
    var talk: Double = 0
    var mouth: Double = 0
    var blink: Double = 0
    var tilt: Double = 0
    var bob: Double = 0
    var brow: Double = 0
    /// 0…1: eyelids drooping (the bored icon face).
    var sleepy: Double = 0
}

/// A cartoon head drawn in a 200×200 design space. While its words are coming in,
/// the mouth opens on each syllable of the channel's audio and the head bobs.
struct AvatarView: View {
    let style: AvatarStyle
    let meter: LevelMeter
    let clock: SpeechClock
    var look: CGFloat = 1

    @State private var animator = AvatarAnimator()

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30)) { timeline in
            Canvas { context, size in
                let pose = animator.pose(at: timeline.date, sound: meter.snapshot(), sinceSpeech: clock.sinceSpeech)
                AvatarPainter(style: style, pose: pose, look: look).draw(in: &context, size: size)
            }
        }
    }
}

/// Smooths the meter into a pose. A reference type so it keeps state between frames.
final class AvatarAnimator {
    private var last: TimeInterval?
    private var talk = 0.0
    private var mouth = 0.0
    private var nextBlink: TimeInterval = 0
    private var blinkStart: TimeInterval = -10
    private let phase = Double.random(in: 0...100)

    func pose(at date: Date, sound: LevelMeter.Snapshot, sinceSpeech: TimeInterval) -> AvatarPose {
        let t = date.timeIntervalSinceReferenceDate
        let dt = min(max(t - (last ?? t), 0), 0.1)
        last = t

        let level = Double(sound.level)
        // Words arrived recently (recognition lags the audio by a second or so): the
        // mouth follows the syllables of the live audio.
        let speaking = sinceSpeech < 2.5
        talk += ((speaking && level > 0.3 ? 1 : 0) - talk) * min(1, dt * 5)

        let tt = t + phase
        let flap = 0.5 + 0.5 * sin(tt * 14 + sin(tt * 4.3) * 2.2)
        let syllable = Double(sound.syllable)
        let target = speaking ? pow(syllable, 1.2) * (0.3 + 0.1 * flap + 0.2 * level * level) : 0
        mouth += (target - mouth) * min(1, dt * (target > mouth ? 18 : 14))

        if nextBlink == 0 { nextBlink = t + .random(in: 1...3) }
        if t >= nextBlink {
            blinkStart = t
            nextBlink = t + (Double.random(in: 0...1) < 0.15 ? 0.3 : .random(in: 2.5...5.5))
        }
        let sinceBlink = t - blinkStart
        let blink = sinceBlink < 0.16 ? sin(sinceBlink / 0.16 * .pi) : 0

        return AvatarPose(
            time: t,
            talk: talk,
            mouth: mouth,
            blink: blink,
            tilt: talk * (sin(tt * 3.1) * 0.07 + sin(tt * 7.7) * 0.025) + sin(tt * 0.7) * 0.03,
            bob: -talk * abs(sin(tt * 6.2)) * 5 + sin(tt * 1.5) * 1.5,
            brow: talk * (2 + 5 * level)
        )
    }
}

struct AvatarPainter {
    let style: AvatarStyle
    let pose: AvatarPose
    let look: CGFloat

    private let ink = AvatarStyle.ink
    private let line = StrokeStyle(lineWidth: 3.2, lineCap: .round, lineJoin: .round)

    func draw(in context: inout GraphicsContext, size: CGSize) {
        let k = min(size.width, size.height) / 200
        context.translateBy(x: (size.width - 200 * k) / 2, y: size.height - 200 * k)
        context.scaleBy(x: k, y: k)

        var head = context
        head.translateBy(x: 100, y: 150 + pose.bob + pose.sleepy * 4)
        head.rotate(by: .radians(pose.tilt))
        head.translateBy(x: -100, y: -150)

        // Shoulders, with a badge telling which side this is.
        let shoulders = Path(roundedRect: CGRect(x: 30, y: 160 + pose.bob * 0.3, width: 140, height: 90), cornerRadius: 50)
        fillAndStroke(&context, shoulders, style.shirt)
        let badge = CGPoint(x: 100, y: 186 + pose.bob * 0.3)
        context.fill(Path(ellipseIn: CGRect(x: badge.x - 15, y: badge.y - 15, width: 30, height: 30)), with: .color(.white.opacity(0.9)))
        context.draw(Text(Image(systemName: style.badge)).font(.system(size: 15, weight: .bold)).foregroundStyle(style.shirt), at: badge)

        let neck = Path(roundedRect: CGRect(x: 86, y: 128, width: 28, height: 40), cornerRadius: 9)
        fillAndStroke(&context, neck, style.skin)
        drawHead(&head)
    }

    private func drawHead(_ c: inout GraphicsContext) {
        if style.hairCut == .bob {
            fillAndStroke(&c, Path(ellipseIn: CGRect(x: 34, y: 26, width: 132, height: 132)), style.hair)
        }
        for x in [46.0, 154.0] {
            fillAndStroke(&c, Path(ellipseIn: CGRect(x: x - 13, y: 88, width: 26, height: 28)), style.skin)
        }
        fillAndStroke(&c, Path(ellipseIn: CGRect(x: 44, y: 34, width: 112, height: 122)), style.skin)
        drawFringe(&c)
        drawFace(&c)
        drawGear(&c)
    }

    private func drawFringe(_ c: inout GraphicsContext) {
        var p = Path()
        switch style.hairCut {
        case .bob:
            p.move(to: CGPoint(x: 45, y: 96))
            p.addCurve(to: CGPoint(x: 100, y: 28), control1: CGPoint(x: 38, y: 50), control2: CGPoint(x: 66, y: 28))
            p.addCurve(to: CGPoint(x: 155, y: 96), control1: CGPoint(x: 134, y: 28), control2: CGPoint(x: 162, y: 50))
            p.addQuadCurve(to: CGPoint(x: 132, y: 62), control: CGPoint(x: 150, y: 66))
            p.addQuadCurve(to: CGPoint(x: 104, y: 66), control: CGPoint(x: 118, y: 72))
            p.addQuadCurve(to: CGPoint(x: 76, y: 58), control: CGPoint(x: 92, y: 54))
            p.addQuadCurve(to: CGPoint(x: 45, y: 96), control: CGPoint(x: 52, y: 64))
        case .short:
            p.move(to: CGPoint(x: 46, y: 90))
            p.addCurve(to: CGPoint(x: 100, y: 26), control1: CGPoint(x: 38, y: 46), control2: CGPoint(x: 64, y: 26))
            p.addCurve(to: CGPoint(x: 154, y: 90), control1: CGPoint(x: 136, y: 26), control2: CGPoint(x: 162, y: 46))
            p.addQuadCurve(to: CGPoint(x: 140, y: 58), control: CGPoint(x: 152, y: 62))
            p.addQuadCurve(to: CGPoint(x: 64, y: 56), control: CGPoint(x: 100, y: 46))
            p.addQuadCurve(to: CGPoint(x: 46, y: 90), control: CGPoint(x: 50, y: 62))
        case .spiky:
            let points: [(Double, Double)] = [
                (46, 86), (40, 62), (56, 60), (52, 40), (72, 44), (76, 22), (94, 36),
                (108, 16), (116, 38), (136, 28), (136, 48), (156, 48), (154, 86),
            ]
            p.move(to: CGPoint(x: points[0].0, y: points[0].1))
            for point in points.dropFirst() { p.addLine(to: CGPoint(x: point.0, y: point.1)) }
            p.addQuadCurve(to: CGPoint(x: 120, y: 58), control: CGPoint(x: 146, y: 60))
            p.addQuadCurve(to: CGPoint(x: 78, y: 60), control: CGPoint(x: 100, y: 68))
            p.addQuadCurve(to: CGPoint(x: 46, y: 86), control: CGPoint(x: 54, y: 60))
        }
        p.closeSubpath()
        fillAndStroke(&c, p, style.hair)
    }

    private func drawFace(_ c: inout GraphicsContext) {
        let lookX = look * 3.5
        let sleepy = pose.sleepy

        for (x, side) in [(78.0, -1.0), (122.0, 1.0)] {
            var brow = c
            brow.translateBy(x: x, y: 75 - pose.brow + sleepy * 3)
            brow.rotate(by: .radians(side * (0.14 - sleepy * 0.22)))
            brow.fill(Path(roundedRect: CGRect(x: -12, y: -3, width: 24, height: 6), cornerRadius: 3), with: .color(ink))
        }

        for x in [78.0, 122.0] {
            let open = max(1 - pose.blink, 0)
            if open < 0.2 {
                var lid = Path()
                lid.move(to: CGPoint(x: x - 10, y: 97))
                lid.addQuadCurve(to: CGPoint(x: x + 10, y: 97), control: CGPoint(x: x, y: 102))
                c.stroke(lid, with: .color(ink), style: line)
                continue
            }
            let height = 26 * open
            let top = 97 - height / 2
            let eye = Path(ellipseIn: CGRect(x: x - 11, y: top, width: 22, height: height))
            c.fill(eye, with: .color(.white))
            var pupil = c
            pupil.clip(to: eye)
            pupil.fill(Path(ellipseIn: CGRect(x: x + lookX - 7.5, y: 100 - 8 + sleepy * 3, width: 15, height: 16)), with: .color(ink))
            pupil.fill(Path(ellipseIn: CGRect(x: x + lookX - 1, y: 94 + sleepy * 3, width: 5, height: 5)), with: .color(.white))
            if sleepy > 0 {
                // Heavy lids: the meeting has been going on for a while.
                let lidY = top + height * 0.58 * sleepy
                pupil.fill(Path(CGRect(x: x - 13, y: top - 2, width: 26, height: lidY - top + 2)), with: .color(style.skin))
                var edge = Path()
                edge.move(to: CGPoint(x: x - 11, y: lidY))
                edge.addLine(to: CGPoint(x: x + 11, y: lidY))
                pupil.stroke(edge, with: .color(ink), style: StrokeStyle(lineWidth: 3, lineCap: .round))
            }
            c.stroke(eye, with: .color(ink), style: StrokeStyle(lineWidth: 2.5))
        }

        for x in [66.0, 134.0] {
            c.fill(Path(ellipseIn: CGRect(x: x - 10, y: 112, width: 20, height: 11)),
                   with: .color(Color(red: 1, green: 0.45, blue: 0.5).opacity(0.35)))
        }

        var nose = Path()
        nose.move(to: CGPoint(x: 96, y: 111))
        nose.addQuadCurve(to: CGPoint(x: 104, y: 111), control: CGPoint(x: 100, y: 117))
        c.stroke(nose, with: .color(ink.opacity(0.7)), style: StrokeStyle(lineWidth: 2.6, lineCap: .round))

        drawMouth(&c)
    }

    private func drawMouth(_ c: inout GraphicsContext) {
        let m = pose.mouth
        if m < 0.06 {
            // A smile, flattening into boredom.
            let smile = 11 - 9 * pose.sleepy
            var curve = Path()
            curve.move(to: CGPoint(x: 87, y: 127))
            curve.addQuadCurve(to: CGPoint(x: 113, y: 127), control: CGPoint(x: 100, y: 127 + smile))
            c.stroke(curve, with: .color(ink), style: line)
            return
        }
        let width = 24 - 5 * m
        let height = 3 + 17 * m
        let top = 125.0
        let corner = top + height * 0.25 - 2.2
        let left = CGPoint(x: 100 - width / 2, y: corner)
        let right = CGPoint(x: 100 + width / 2, y: corner)
        var mouth = Path()
        mouth.move(to: left)
        mouth.addQuadCurve(to: right, control: CGPoint(x: 100, y: top - height * 0.3))
        mouth.addCurve(to: left, control1: CGPoint(x: right.x - width * 0.1, y: top + height * 1.12),
                       control2: CGPoint(x: left.x + width * 0.1, y: top + height * 1.12))
        mouth.closeSubpath()
        c.fill(mouth, with: .color(Color(red: 0.36, green: 0.10, blue: 0.18)))
        var inside = c
        inside.clip(to: mouth)
        let bottom = top + height * 0.65
        inside.fill(Path(ellipseIn: CGRect(x: 100 - width * 0.3, y: bottom - height * 0.35, width: width * 0.6, height: height * 0.6)),
                    with: .color(Color(red: 1, green: 0.47, blue: 0.53)))
        c.stroke(mouth, with: .color(ink), style: StrokeStyle(lineWidth: 2.4, lineCap: .round, lineJoin: .round))
    }

    private func drawGear(_ c: inout GraphicsContext) {
        let gear = AvatarStyle.ink.opacity(0.92)
        switch style.gear {
        case .headphones:
            var band = Path()
            band.addArc(center: CGPoint(x: 100, y: 96), radius: 64, startAngle: .degrees(195), endAngle: .degrees(345), clockwise: false)
            c.stroke(band, with: .color(gear), style: StrokeStyle(lineWidth: 9, lineCap: .round))
            c.stroke(band, with: .color(style.accent), style: StrokeStyle(lineWidth: 3, lineCap: .round))
            for x in [40.0, 160.0] {
                fillAndStroke(&c, Path(roundedRect: CGRect(x: x - 11, y: 80, width: 22, height: 40), cornerRadius: 10), style.accent)
            }
        case .headset:
            fillAndStroke(&c, Path(ellipseIn: CGRect(x: 145, y: 91, width: 20, height: 22)), style.accent)
            var boom = Path()
            boom.move(to: CGPoint(x: 152, y: 112))
            boom.addQuadCurve(to: CGPoint(x: 126, y: 138), control: CGPoint(x: 150, y: 140))
            c.stroke(boom, with: .color(gear), style: StrokeStyle(lineWidth: 4, lineCap: .round))
            fillAndStroke(&c, Path(roundedRect: CGRect(x: 114, y: 132, width: 15, height: 11), cornerRadius: 5.5), style.accent, width: 2.2)
        }
    }

    private func fillAndStroke(_ c: inout GraphicsContext, _ path: Path, _ color: Color, width: CGFloat = 3.2) {
        c.fill(path, with: .color(color))
        c.stroke(path, with: .color(ink), style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
    }
}

/// A rounded speech bubble with a tail at the bottom left or right.
struct BubbleShape: Shape {
    var tailLeading: Bool
    var radius: CGFloat
    var tail: CGSize

    func path(in rect: CGRect) -> Path {
        let body = CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height - tail.height)
        let bubble = Path(roundedRect: body, cornerRadius: radius, style: .continuous)
        var tailPath = Path()
        let base = body.maxY - 2
        if tailLeading {
            let x = body.minX + radius * 0.9
            tailPath.move(to: CGPoint(x: x, y: base))
            tailPath.addQuadCurve(to: CGPoint(x: x - tail.width * 0.55, y: rect.maxY), control: CGPoint(x: x, y: base + tail.height * 0.6))
            tailPath.addQuadCurve(to: CGPoint(x: x + tail.width, y: base), control: CGPoint(x: x + tail.width * 0.25, y: base + tail.height * 0.55))
        } else {
            let x = body.maxX - radius * 0.9
            tailPath.move(to: CGPoint(x: x, y: base))
            tailPath.addQuadCurve(to: CGPoint(x: x + tail.width * 0.55, y: rect.maxY), control: CGPoint(x: x, y: base + tail.height * 0.6))
            tailPath.addQuadCurve(to: CGPoint(x: x - tail.width, y: base), control: CGPoint(x: x - tail.width * 0.25, y: base + tail.height * 0.55))
        }
        tailPath.closeSubpath()
        return bubble.union(tailPath)
    }
}
