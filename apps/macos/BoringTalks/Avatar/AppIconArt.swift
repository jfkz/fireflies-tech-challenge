import AppKit
import SwiftUI

/// `--icon <AppIcon.appiconset>`: draws the app icon in every size, the way Talking
/// Heads draws its own: a head that has sat through one meeting too many, dozing
/// off, while its speech bubble keeps taking notes.
enum AppIconArt {
    @MainActor
    static func write(to folder: URL) throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var images: [[String: String]] = []
        for (points, scale) in [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2), (256, 1), (256, 2), (512, 1), (512, 2)] {
            let pixels = points * scale
            let name = "icon_\(points)x\(points)\(scale == 2 ? "@2x" : "").png"
            try render(IconView(), size: 1024, pixels: pixels, to: folder.appendingPathComponent(name))
            images.append(["idiom": "mac", "size": "\(points)x\(points)", "scale": "\(scale)x", "filename": name])
        }
        let contents: [String: Any] = ["images": images, "info": ["author": "xcode", "version": 1]]
        let data = try JSONSerialization.data(withJSONObject: contents, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: folder.appendingPathComponent("Contents.json"))
    }

    @MainActor
    private static func render(_ view: some View, size: CGFloat, pixels: Int, to url: URL) throws {
        let renderer = ImageRenderer(content: view.frame(width: size, height: size))
        renderer.scale = CGFloat(pixels) / size
        renderer.isOpaque = false
        guard let image = renderer.cgImage,
              let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
            throw CocoaError(.fileWriteUnknown)
        }
        try png.write(to: url)
    }
}

private struct IconView: View {
    private let corner: CGFloat = 185

    var body: some View {
        ZStack {
            // macOS icon grid: an 824-point rounded square in the 1024 canvas.
            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .fill(LinearGradient(colors: [Color(red: 0.99, green: 0.76, blue: 0.36), Color(red: 0.95, green: 0.45, blue: 0.36)],
                                     startPoint: .top, endPoint: .bottom))
                .frame(width: 824, height: 824)
                .shadow(color: .black.opacity(0.3), radius: 14, y: 10)
            Canvas { context, size in
                let pose = AvatarPose(time: 0.6, sleepy: 1)
                AvatarPainter(style: .listener, pose: pose, look: 1).draw(in: &context, size: size)
            }
            .frame(width: 560, height: 560)
            .offset(x: -110, y: 132)
            .frame(width: 824, height: 824)
            .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
            Text("z")
                .font(.system(size: 92, weight: .black, design: .rounded))
                .foregroundStyle(.white)
                .offset(x: 235, y: 40)
            Text("z")
                .font(.system(size: 64, weight: .black, design: .rounded))
                .foregroundStyle(.white.opacity(0.85))
                .offset(x: 170, y: 100)
            NotesBubble()
                .frame(width: 360, height: 290)
                .offset(x: 196, y: -196)
        }
        .frame(width: 1024, height: 1024)
    }
}

/// The bubble, writing the transcript all by itself.
private struct NotesBubble: View {
    var body: some View {
        let shape = BubbleShape(tailLeading: true, radius: 64, tail: CGSize(width: 70, height: 60))
        ZStack(alignment: .topLeading) {
            shape.fill(.white)
            shape.stroke(AvatarStyle.ink, lineWidth: 14)
            VStack(alignment: .leading, spacing: 30) {
                ForEach([0.9, 0.7, 0.82], id: \.self) { width in
                    Capsule().fill(AvatarStyle.ink.opacity(0.8)).frame(width: 250 * width, height: 26)
                }
            }
            .padding(.leading, 52)
            .padding(.top, 52)
        }
    }
}
