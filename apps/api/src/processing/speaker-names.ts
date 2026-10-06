import type { SpeakerNameMap } from '../db/schema';

/** What the summarizer says about one speaker label. */
export interface SpeakerGuess {
  label: string;
  name: string | null;
  role: string | null;
}

/** Labels the recorders make up; anything else (an uploaded "Dana") already is a name. */
const PLACEHOLDER = /^(you|others|speaker\s*\d+|unknown( speaker)?)$/i;
/** Answers that are not names at all. */
const NOT_A_NAME = /^(you|me|i|unknown|n\/?a|none|null|speaker(\s*\d+)?|other|others|someone|participant|host|guest|the user|user|everyone|team)$/i;
const NAME_MAX = 40;
const ROLE_MAX = 30;

export function isPlaceholderLabel(label: string): boolean {
  return PLACEHOLDER.test(label.trim());
}

/** "mikhail pershin" → "Mikhail": the account name, shortened to how people address each other. */
export function firstName(full: string | null | undefined): string | null {
  const first = full?.trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{M}'’-]/gu, '');
  if (!first || first.length < 2) return null;
  return first[0].toLocaleUpperCase() + first.slice(1);
}

function clean(value: string | null | undefined, max: number): string | null {
  const v = value
    ?.trim()
    .replace(/^["'“”«»]+|["'“”«».]+$/g, '')
    .replace(/\s+/g, ' ');
  if (!v || v.length > max || NOT_A_NAME.test(v) || /speaker/i.test(v)) return null;
  return v;
}

function capitalize(v: string): string {
  return v[0].toLocaleUpperCase() + v.slice(1);
}

/**
 * Turns the summarizer's guesses into display names for placeholder labels:
 * "You" becomes the account holder's first name; others get the name the
 * conversation revealed, else a clear role ("Recruiter"), else keep their label.
 * Names a person set by hand are kept, and no two speakers end up with the same name.
 */
export function resolveSpeakerNames(
  labels: readonly string[],
  guesses: readonly SpeakerGuess[],
  ownerName: string | null,
  existing: SpeakerNameMap = {},
): SpeakerNameMap {
  const out: SpeakerNameMap = {};
  const taken = new Set<string>();
  const claim = (label: string, name: string, by: 'ai' | 'user') => {
    let unique = name;
    // A person may give two labels the same name on purpose (one voice split in two); a guess never does.
    for (let n = 2; by === 'ai' && taken.has(unique.toLocaleLowerCase()); n++) unique = `${name} ${n}`;
    taken.add(unique.toLocaleLowerCase());
    if (unique !== label || by === 'user') out[label] = { name: unique, by };
  };

  // Names the user chose, and labels that are already names, come first and are never renamed.
  for (const label of labels) {
    const manual = Object.hasOwn(existing, label) && existing[label].by === 'user' ? existing[label].name : null;
    if (manual) claim(label, manual, 'user');
    else if (!isPlaceholderLabel(label)) taken.add(label.toLocaleLowerCase());
  }
  for (const label of labels) {
    if (Object.hasOwn(out, label) || !isPlaceholderLabel(label)) continue;
    const guess = guesses.find((g) => g.label.trim().toLowerCase() === label.toLowerCase());
    const owner = /^you$/i.test(label) ? firstName(ownerName) : null;
    const name = owner ?? clean(guess?.name, NAME_MAX);
    const role = clean(guess?.role, ROLE_MAX);
    if (name) claim(label, name, 'ai');
    else if (role) claim(label, capitalize(role), 'ai');
  }
  return out;
}

/** Flattens the stored map to label → display name. */
export function displayNames(map: SpeakerNameMap): Record<string, string> {
  return Object.fromEntries(Object.entries(map).map(([label, e]) => [label, e.name]));
}

/**
 * Applies a person's renames ("current display name" → "new name") to a meeting's
 * speakers. Returns the new map and the display-name changes made, or null when a
 * name to rename isn't one of the meeting's speakers.
 */
export function renameSpeakers(
  labels: readonly string[],
  map: SpeakerNameMap,
  renames: Readonly<Record<string, string>>,
): { map: SpeakerNameMap; changes: [from: string, to: string][] } | null {
  const next: SpeakerNameMap = { ...map };
  const changes: [string, string][] = [];
  const display = (label: string) => (Object.hasOwn(map, label) ? map[label].name : label);
  for (const [from, to] of Object.entries(renames)) {
    const matching = labels.filter((l) => display(l) === from);
    if (matching.length === 0) return null;
    for (const label of matching) next[label] = { name: to, by: 'user' };
    if (from !== to) changes.push([from, to]);
  }
  return { map: next, changes };
}
