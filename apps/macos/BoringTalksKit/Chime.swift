import Foundation

/// The two short tones played when a recording starts (rising) and stops (falling), made in memory
/// as a 16-bit mono WAV: no audio files to ship. A soft attack and an exponential decay, so they
/// click neither in nor out; quiet (a quarter of full scale). The Windows app makes the same ones.
public enum Chime {
    public static let sampleRate = 44_100
    public static let toneSeconds = 0.09
    public static let peak: Float = 0.25

    /// How long a chime plays, to wait it out before the microphone opens.
    public static var duration: TimeInterval { toneSeconds * 2 }

    /// E5 then A5 to start; the other way round to stop.
    public static func wav(rising: Bool) -> Data {
        wavData(samples(frequencies: rising ? [659.25, 880.0] : [880.0, 659.25]))
    }

    public static func samples(frequencies: [Double]) -> [Float] {
        let perTone = Int(Double(sampleRate) * toneSeconds)
        let attack = Double(sampleRate) * 0.005
        var out = [Float](repeating: 0, count: perTone * frequencies.count)
        for (t, frequency) in frequencies.enumerated() {
            for i in 0..<perTone {
                let envelope = min(1.0, Double(i) / attack) * exp(-5.0 * Double(i) / Double(perTone))
                out[t * perTone + i] = Float(Double(peak) * envelope * sin(2 * .pi * frequency * Double(i) / Double(sampleRate)))
            }
        }
        return out
    }

    public static func wavData(_ samples: [Float]) -> Data {
        var data = Data()
        func append<T: FixedWidthInteger>(_ value: T) {
            withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
        }
        let dataBytes = samples.count * 2
        data.append(contentsOf: Array("RIFF".utf8))
        append(UInt32(36 + dataBytes))
        data.append(contentsOf: Array("WAVEfmt ".utf8))
        append(UInt32(16))
        append(UInt16(1))
        append(UInt16(1))
        append(UInt32(sampleRate))
        append(UInt32(sampleRate * 2))
        append(UInt16(2))
        append(UInt16(16))
        data.append(contentsOf: Array("data".utf8))
        append(UInt32(dataBytes))
        for sample in samples {
            append(Int16(max(-32768, min(32767, (sample * 32767).rounded()))))
        }
        return data
    }
}
