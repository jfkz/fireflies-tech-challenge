/** Matches in a server snippet are wrapped in these (see the API's ts_headline call). */
const HIT_START = '⟦';
const HIT_END = '⟧';

export interface Part {
  text: string;
  hit: boolean;
}

/** "we agreed ⟦pricing⟧ is fine" → [we agreed ][pricing*][ is fine]. */
export function markedParts(snippet: string): Part[] {
  const parts: Part[] = [];
  for (const [i, piece] of snippet.split(HIT_START).entries()) {
    if (i === 0) {
      if (piece) parts.push({ text: piece, hit: false });
      continue;
    }
    const end = piece.indexOf(HIT_END);
    if (end < 0) {
      parts.push({ text: piece, hit: false });
      continue;
    }
    if (end > 0) parts.push({ text: piece.slice(0, end), hit: true });
    if (piece.length > end + 1) parts.push({ text: piece.slice(end + 1), hit: false });
  }
  return parts;
}

/** The words of a search, lower-cased, without operators or excluded words ("-draft"). */
export function searchTerms(q: string): string[] {
  const words: string[] = [];
  for (const m of q.matchAll(/(-?)"([^"]*)"|(-?)([^\s"]+)/gu)) {
    if ((m[1] ?? m[3]) === '-') continue;
    const text = m[2] ?? m[4];
    if (m[4] !== undefined && /^or$/i.test(text)) continue;
    words.push(...(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
  }
  return [...new Set(words)];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Splits text where it matches the search, the way the server does: each term as the start of a word. */
export function highlightParts(text: string, terms: readonly string[]): Part[] {
  if (terms.length === 0) return [{ text, hit: false }];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map(escape).join('|')})[\\p{L}\\p{N}]*`, 'giu');
  const parts: Part[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index), hit: false });
    parts.push({ text: m[0], hit: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}

export function hasMatch(text: string, terms: readonly string[]): boolean {
  return highlightParts(text, terms).some((p) => p.hit);
}
