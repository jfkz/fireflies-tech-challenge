import Accelerate
import Foundation

/// Measurable characteristics of a voice in a stretch of 16 kHz audio, used next to
/// the neural embedding to tell voices apart: how high it is, how much it moves
/// (flat or lively intonation), its timbre (the shape of the spectrum, as cepstral
/// coefficients), how bright it sounds and how breathy or rough it is.
struct VoiceTraits {
    /// Median fundamental frequency, Hz.
    var pitch: Float?
    /// Spread of the pitch: interquartile range in semitones.
    var pitchRange: Float?
    /// Mean of the cepstral coefficients c1…c12 over voiced frames: the timbre.
    var timbre: [Float]
    /// Mean spectral centroid of voiced frames, Hz.
    var brightness: Float
    /// Mean YIN aperiodicity of voiced frames: low for a clear voice, higher for a
    /// breathy or rough one.
    var breathiness: Float
    /// Voiced frames the traits come from.
    var voicedFrames: Int

    static let coefficients = 12

    /// nil when there is too little voiced speech to measure.
    static func measure(_ samples: ArraySlice<Float>) -> VoiceTraits? {
        let analyzer = Analyzer.shared
        return analyzer.measure(Array(samples))
    }

    /// Per-trait gaps between two voices, in units that suit each trait.
    func gaps(to other: VoiceTraits) -> [Float] {
        var pitchGap: Float = 0, rangeGap: Float = 0
        if let a = pitch, let b = other.pitch { pitchGap = abs(12 * log2(a / b)) }
        if let a = pitchRange, let b = other.pitchRange { rangeGap = abs(a - b) }
        var timbreGap: Float = 0
        vDSP_distancesq(timbre, 1, other.timbre, 1, &timbreGap, vDSP_Length(min(timbre.count, other.timbre.count)))
        return [
            pitchGap,
            rangeGap,
            timbreGap.squareRoot(),
            abs(12 * log2(max(brightness, 1) / max(other.brightness, 1))),
            abs(breathiness - other.breathiness),
        ]
    }

    /// Running average with another measurement of the same voice.
    mutating func merge(_ other: VoiceTraits) {
        let total = Float(voicedFrames + other.voicedFrames)
        guard total > 0 else { return }
        let a = Float(voicedFrames) / total, b = Float(other.voicedFrames) / total
        func mix(_ x: Float?, _ y: Float?) -> Float? {
            switch (x, y) {
            case let (x?, y?): x * a + y * b
            default: x ?? y
            }
        }
        if let p = pitch, let q = other.pitch {
            pitch = exp2(log2(p) * a + log2(q) * b)
        } else {
            pitch = pitch ?? other.pitch
        }
        pitchRange = mix(pitchRange, other.pitchRange)
        timbre = zip(timbre, other.timbre).map { $0 * a + $1 * b }
        brightness = brightness * a + other.brightness * b
        breathiness = breathiness * a + other.breathiness * b
        voicedFrames += other.voicedFrames
    }

    /// FFT set-up shared by all measurements.
    private final class Analyzer: @unchecked Sendable {
        static let shared = Analyzer()

        let rate: Float = 16000
        let fftSize = 512
        let hop = 320
        let yinFrame = 640
        let minLag = 40, maxLag = 228 // 400 Hz … 70 Hz
        let bands = 26
        private let dft: vDSP.DiscreteFourierTransform<Float>?
        private let window: [Float]
        private let filters: [[Float]]
        private let dct: [[Float]]
        private let lock = NSLock()

        private init() {
            dft = try? vDSP.DiscreteFourierTransform(count: fftSize, direction: .forward, transformType: .complexComplex, ofType: Float.self)
            window = vDSP.window(ofType: Float.self, usingSequence: .hanningDenormalized, count: fftSize, isHalfWindow: false)
            // Triangular mel filters from 60 Hz to 7.6 kHz.
            func mel(_ hz: Float) -> Float { 2595 * log10(1 + hz / 700) }
            func hz(_ mel: Float) -> Float { 700 * (pow(10, mel / 2595) - 1) }
            let bands = 26, fftSize = 512
            let low = mel(60), high = mel(7600)
            let edges = (0...(bands + 1)).map { hz(low + (high - low) * Float($0) / Float(bands + 1)) }
            let bins = fftSize / 2
            filters = (0..<bands).map { band in
                (0..<bins).map { bin in
                    let f = Float(bin) * 16000 / Float(fftSize)
                    let (a, b, c) = (edges[band], edges[band + 1], edges[band + 2])
                    if f <= a || f >= c { return 0 }
                    return f < b ? (f - a) / (b - a) : (c - f) / (c - b)
                }
            }
            dct = (1...VoiceTraits.coefficients).map { k in
                (0..<bands).map { n in cos(Float.pi * Float(k) * (Float(n) + 0.5) / Float(bands)) }
            }
        }

        func measure(_ x: [Float]) -> VoiceTraits? {
            lock.lock()
            defer { lock.unlock() }
            guard let dft, x.count >= yinFrame + maxLag else { return nil }
            var energy: Float = 0
            vDSP_rmsqv(x, 1, &energy, vDSP_Length(x.count))
            let gate = max(energy * 0.5, 1e-3)

            var pitches: [Float] = []
            var aperiodicity: Float = 0
            var timbre = [Float](repeating: 0, count: VoiceTraits.coefficients)
            var brightness: Float = 0
            var voiced = 0

            var difference = [Float](repeating: 0, count: maxLag + 1)
            var normalized = [Float](repeating: 1, count: maxLag + 1)
            let bins = fftSize / 2
            var real = [Float](repeating: 0, count: fftSize), imag = [Float](repeating: 0, count: fftSize)
            var outReal = [Float](repeating: 0, count: fftSize), outImag = [Float](repeating: 0, count: fftSize)
            var power = [Float](repeating: 0, count: bins)
            let frequencies = (0..<bins).map { Float($0) * rate / Float(fftSize) }

            x.withUnsafeBufferPointer { buffer in
                guard let base = buffer.baseAddress else { return }
                var start = 0
                while start + max(yinFrame + maxLag, fftSize) <= x.count {
                    defer { start += hop }
                    var rms: Float = 0
                    vDSP_rmsqv(base + start, 1, &rms, vDSP_Length(yinFrame))
                    guard rms > gate else { continue }

                    // YIN: pitch, and how periodic the frame is.
                    for lag in 1...maxLag {
                        vDSP_distancesq(base + start, 1, base + start + lag, 1, &difference[lag], vDSP_Length(yinFrame))
                    }
                    var running: Float = 0
                    for lag in 1...maxLag {
                        running += difference[lag]
                        normalized[lag] = difference[lag] * Float(lag) / max(running, 1e-9)
                    }
                    var found: Int?
                    var lag = minLag
                    while lag <= maxLag {
                        if normalized[lag] < 0.2 {
                            while lag < maxLag, normalized[lag + 1] < normalized[lag] { lag += 1 }
                            found = lag
                            break
                        }
                        lag += 1
                    }
                    guard let found else { continue }
                    pitches.append(rate / Float(found))
                    aperiodicity += normalized[found]

                    // Spectrum: mel cepstrum and centroid.
                    vDSP.multiply(UnsafeBufferPointer(start: base + start, count: fftSize), window, result: &real)
                    vDSP.fill(&imag, with: 0)
                    dft.transform(inputReal: real, inputImaginary: imag, outputReal: &outReal, outputImaginary: &outImag)
                    for bin in 0..<bins {
                        power[bin] = outReal[bin] * outReal[bin] + outImag[bin] * outImag[bin]
                    }
                    let total = max(vDSP.sum(power), 1e-12)
                    brightness += vDSP.dot(power, frequencies) / total
                    let logBands = filters.map { log(max(vDSP.dot($0, power), 1e-10)) }
                    for k in 0..<VoiceTraits.coefficients {
                        timbre[k] += vDSP.dot(dct[k], logBands)
                    }
                    voiced += 1
                }
            }
            guard voiced >= 8 else { return nil }
            let n = Float(voiced)
            let sorted = pitches.sorted()
            let quartile = { (q: Float) in sorted[min(sorted.count - 1, Int(Float(sorted.count - 1) * q))] }
            return VoiceTraits(
                pitch: quartile(0.5),
                pitchRange: 12 * log2(quartile(0.75) / quartile(0.25)),
                timbre: timbre.map { $0 / n },
                brightness: brightness / n,
                breathiness: aperiodicity / n,
                voicedFrames: voiced
            )
        }
    }
}
