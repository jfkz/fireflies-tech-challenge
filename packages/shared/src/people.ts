import { z } from 'zod';
import { FacetCount, MeetingRef, SpeakerName, TaskItem } from './meeting';

/**
 * A person: the same speaker name across meetings (case-insensitive), so "Maya" links every
 * meeting she spoke in. Unnamed voices ("Speaker 2"), roles ("Recruiter") and the account
 * holder aren't people here.
 */
export const PersonSummary = z.object({
  name: z.string(),
  meetingCount: z.number().int().nonnegative(),
  /** The meetings they were in, added up: time spent together. */
  togetherSec: z.number().int().nonnegative(),
  /** How long they spoke in those meetings. */
  talkSec: z.number().int().nonnegative(),
  lastMetAt: z.string().datetime(),
  /** Action items they own that aren't done. */
  openTasks: z.number().int().nonnegative(),
});
export type PersonSummary = z.infer<typeof PersonSummary>;

export const PeopleQuery = z.object({
  /** Only meetings from the last this many days; all time when left out. */
  days: z.coerce.number().int().min(1).max(3650).optional(),
});
export type PeopleQuery = z.infer<typeof PeopleQuery>;

/** Everyone the user meets, most time together first. */
export const PeopleList = z.object({
  since: z.string().datetime().nullable(),
  /** All the user's meetings in the period, added up (with people or not). */
  meetingSec: z.number().int().nonnegative(),
  people: z.array(PersonSummary),
});
export type PeopleList = z.infer<typeof PeopleList>;

export const PersonMeeting = MeetingRef.extend({
  durationSec: z.number().int().nonnegative().nullable(),
  /** How long this person spoke in it. */
  talkSec: z.number().int().nonnegative(),
});
export type PersonMeeting = z.infer<typeof PersonMeeting>;

export const PersonDetail = PersonSummary.extend({
  /** Newest first. */
  meetings: z.array(PersonMeeting),
  /** Topic tags of their meetings, most frequent first. */
  topics: z.array(FacetCount),
  /** Action items they own, open first. */
  tasks: z.array(TaskItem),
});
export type PersonDetail = z.infer<typeof PersonDetail>;

/** Renames a person in every meeting; renaming to someone else's name merges the two. */
export const RenamePersonRequest = z.object({ name: SpeakerName });
export type RenamePersonRequest = z.infer<typeof RenamePersonRequest>;
