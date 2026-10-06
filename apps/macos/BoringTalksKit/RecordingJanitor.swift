import Foundation
import NaturalLanguage

/// Deletes recordings that have uploaded and aged past the "keep audio" setting.
public enum RecordingJanitor {
    /// Removes `.m4a` files in `folder` older than `keepDays`, except `protected`
    /// ones (still in the upload queue) and the one being recorded. Returns the
    /// names it deleted.
    @discardableResult
    public static func prune(folder: URL, keepDays: Int, protected: Set<String>, now: Date = Date()) -> [String] {
        let manager = FileManager.default
        guard let files = try? manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey]) else {
            return []
        }
        let cutoff = now.addingTimeInterval(-Double(max(0, keepDays)) * 86_400)
        var deleted: [String] = []
        for file in files where file.pathExtension == "m4a" && !protected.contains(file.lastPathComponent) {
            let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? now
            if modified < cutoff, (try? manager.removeItem(at: file)) != nil {
                deleted.append(file.lastPathComponent)
            }
        }
        return deleted.sorted()
    }
}

/// The language of a transcript, when the user left it on "auto".
public enum LanguageGuess {
    /// ISO 639-1 code, or nil for too little or mixed text.
    public static func detect(_ text: String, minimumConfidence: Double = 0.6) -> String? {
        guard text.split(separator: " ").count >= 3 else { return nil }
        let recognizer = NLLanguageRecognizer()
        recognizer.processString(text)
        guard let (language, confidence) = recognizer.languageHypotheses(withMaximum: 1).first,
              confidence >= minimumConfidence else { return nil }
        return language.rawValue
    }
}
