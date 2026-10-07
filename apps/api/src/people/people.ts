import type { PersonMeeting, PersonSummary } from '@boringtalks/shared';
import type { SpeakerNameMap } from '../db/schema';
import { firstName, isPlaceholderLabel } from '../processing/speaker-names';

/** One speaker of one meeting, with how long they spoke. */
export interface SpeakerTimeRow {
  meetingId: string;
  title: string;
  startedAt: Date;
  /** The meeting's length (or, without one, where its transcript ends). */
  durationSec: number | null;
  topics: string[];
  speakerNames: SpeakerNameMap;
  label: string;
  talkMs: number;
}

export interface PersonMeetingTime {
  id: string;
  title: string;
  startedAt: Date;
  durationSec: number | null;
  talkMs: number;
  topics: string[];
}

/** One person across meetings, keyed by their name in lower case. */
export interface PersonTime {
  key: string;
  /** As spelled in their latest meeting. */
  name: string;
  meetings: PersonMeetingTime[];
}

/** People are the same name in any case: "Maya" and "maya" are one person. */
export const personKey = (name: string): string => name.trim().toLocaleLowerCase();

function isOwner(name: string, owner: string | null): boolean {
  if (!owner?.trim()) return false;
  const key = personKey(name);
  return key === personKey(owner) || key === personKey(firstName(owner) ?? '');
}

/**
 * The person behind a speaker label, or null for the account holder ("You", or their own name
 * among numbered speakers), an unnamed voice ("Speaker 2") and a role the summarizer gave
 * for want of a name ("Recruiter").
 */
export function personName(label: string, names: SpeakerNameMap, owner: string | null): string | null {
  if (/^you$/i.test(label.trim())) return null;
  const entry = Object.hasOwn(names, label) ? names[label] : undefined;
  if (entry?.role) return null;
  const name = (entry?.name ?? label).trim();
  if (!name || isPlaceholderLabel(name) || isOwner(name, owner)) return null;
  return name;
}

/** Speaker rows → people, each with the meetings they spoke in (newest first). */
export function groupPeople(rows: readonly SpeakerTimeRow[], owner: string | null): Map<string, PersonTime> {
  const people = new Map<string, { name: string; latest: number; meetings: Map<string, PersonMeetingTime> }>();
  for (const row of rows) {
    const name = personName(row.label, row.speakerNames, owner);
    if (!name) continue;
    const key = personKey(name);
    const person = people.get(key) ?? { name, latest: -Infinity, meetings: new Map() };
    if (row.startedAt.getTime() > person.latest) Object.assign(person, { name, latest: row.startedAt.getTime() });
    // Two labels of one meeting can be the same person (a voice split in two): add their talk up.
    const m = person.meetings.get(row.meetingId);
    if (m) m.talkMs += row.talkMs;
    else {
      person.meetings.set(row.meetingId, {
        id: row.meetingId,
        title: row.title,
        startedAt: row.startedAt,
        durationSec: row.durationSec,
        talkMs: row.talkMs,
        topics: row.topics,
      });
    }
    people.set(key, person);
  }
  return new Map(
    [...people].map(([key, p]) => [key, { key, name: p.name, meetings: [...p.meetings.values()].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()) }]),
  );
}

export function toSummary(p: PersonTime, openTasks: number): PersonSummary {
  return {
    name: p.name,
    meetingCount: p.meetings.length,
    togetherSec: p.meetings.reduce((sum, m) => sum + (m.durationSec ?? 0), 0),
    talkSec: Math.round(p.meetings.reduce((sum, m) => sum + m.talkMs, 0) / 1000),
    lastMetAt: p.meetings[0].startedAt.toISOString(),
    openTasks,
  };
}

export function toPersonMeeting(m: PersonMeetingTime): PersonMeeting {
  return { id: m.id, title: m.title, startedAt: m.startedAt.toISOString(), durationSec: m.durationSec, talkSec: Math.round(m.talkMs / 1000) };
}

/** Most time together first, then most talk, then by name. */
export function byTimeTogether(a: PersonSummary, b: PersonSummary): number {
  return b.togetherSec - a.togetherSec || b.talkSec - a.talkSec || a.name.localeCompare(b.name);
}
