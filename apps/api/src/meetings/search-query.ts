/**
 * Turns what someone typed into a Postgres tsquery (for to_tsquery('simple', …)).
 *
 * - words match as prefixes, so results appear while typing ("pric" finds "pricing");
 * - "quoted phrases" match words in that order;
 * - -word excludes; `or` between words means either.
 *
 * Only letters and digits ever reach the tsquery, so its syntax can't be injected.
 */
export function toTsQuery(input: string): string | null {
  const parts: string[] = [];
  let pendingOr = false;
  const re = /(-?)"([^"]*)"|(-?)([^\s"]+)/gu;
  for (const m of input.matchAll(re)) {
    const negate = (m[1] ?? m[3]) === '-';
    let term: string | null;
    if (m[2] !== undefined) {
      const words = terms(m[2]);
      term = words.length ? (words.length === 1 ? words[0] : `(${words.join(' <-> ')})`) : null;
    } else {
      if (/^or$/i.test(m[4]) && parts.length > 0) {
        pendingOr = true;
        continue;
      }
      // "q3-planning" is two words that must both match.
      const words = terms(m[4]).map((w) => `${w}:*`);
      term = words.length ? (words.length === 1 ? words[0] : `(${words.join(' & ')})`) : null;
    }
    if (!term) continue;
    if (negate) term = `!${term}`;
    if (pendingOr && parts.length > 0) parts.push(`${parts.pop()} | ${term}`);
    else parts.push(term);
    pendingOr = false;
  }
  const positive = parts.some((p) => !p.startsWith('!'));
  return parts.length && positive ? parts.join(' & ') : null;
}

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12);
}

/** Markers ts_headline wraps around matches; the web app turns them into <mark>. */
export const HIT_START = '⟦';
export const HIT_END = '⟧';
