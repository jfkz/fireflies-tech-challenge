export const TOPICS_MAX = 4;
const TOPIC_LEN_MAX = 40;

/**
 * Cleans the summarizer's topic tags: trimmed, short, at most TOPICS_MAX, no
 * duplicates, and spelled like a tag the user already has when one matches
 * case-insensitively, so filters group meetings together.
 */
export function normalizeTopics(drafts: readonly string[], known: readonly string[] = []): string[] {
  const byKey = new Map(known.map((t) => [t.toLocaleLowerCase(), t]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of drafts) {
    const t = raw
      .trim()
      .replace(/^#/, '')
      .replace(/[.!;:]+$/, '')
      .replace(/\s+/g, ' ');
    if (!t || t.length > TOPIC_LEN_MAX) continue;
    const key = t.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(byKey.get(key) ?? t[0].toLocaleUpperCase() + t.slice(1));
    if (out.length === TOPICS_MAX) break;
  }
  return out;
}
