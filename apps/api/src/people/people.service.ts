import { Injectable, NotFoundException } from '@nestjs/common';
import { speakerName, type FacetCount, type PeopleList, type PersonDetail } from '@boringtalks/shared';
import type { UserRow } from '../db/schema';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { displayNames, renameSpeakers } from '../processing/speaker-names';
import { toTask } from '../tasks/tasks.service';
import { byTimeTogether, groupPeople, personKey, toPersonMeeting, toSummary, type PersonTime } from './people';
import { PeopleRepository } from './people.repository';

const DAY_MS = 86_400_000;

/** People across meetings: who the user meets, for how long, and what they took on. */
@Injectable()
export class PeopleService {
  constructor(
    private readonly repo: PeopleRepository,
    private readonly meetings: MeetingsRepository,
  ) {}

  async list(user: UserRow, days?: number): Promise<PeopleList> {
    const since = days ? new Date(Date.now() - days * DAY_MS) : null;
    const [rows, meetingSec, open] = await Promise.all([
      this.repo.speakerTime(user.id, since),
      this.repo.meetingSeconds(user.id, since),
      this.repo.openTasksByOwner(user.id),
    ]);
    const people = [...groupPeople(rows, user.name).values()].map((p) => toSummary(p, open.get(p.key) ?? 0)).sort(byTimeTogether);
    return { since: since?.toISOString() ?? null, meetingSec, people };
  }

  async get(user: UserRow, name: string): Promise<PersonDetail> {
    const person = await this.find(user, name);
    const tasks = await this.repo.tasksOf(user.id, person.key);
    const open = tasks.filter((t) => !t.done).length;
    return {
      ...toSummary(person, open),
      meetings: person.meetings.map(toPersonMeeting),
      topics: topicCounts(person),
      tasks: tasks.map(toTask),
    };
  }

  /**
   * Renames a person in every meeting they spoke in, and their action items. Renaming to the
   * name of someone else merges the two: from then on they are one person.
   */
  async rename(user: UserRow, name: string, to: string): Promise<PersonDetail> {
    const person = await this.find(user, name);
    const newName = to.trim();
    for (const m of person.meetings) {
      const row = await this.meetings.findById(m.id);
      if (!row) continue;
      const labels = await this.meetings.speakerLabels(m.id);
      const display = (l: string) => speakerName(l, displayNames(row.speakerNames));
      const renames = Object.fromEntries(labels.filter((l) => personKey(display(l)) === person.key).map((l) => [display(l), newName]));
      const renamed = Object.keys(renames).length ? renameSpeakers(labels, row.speakerNames, renames) : null;
      if (!renamed) continue;
      const names = displayNames(renamed.map);
      await this.meetings.saveSpeakerNames(m.id, renamed.map, [...new Set(labels.map((l) => speakerName(l, names)))], renamed.changes);
    }
    await this.repo.renameOwner(user.id, person.key, newName);
    return this.get(user, newName);
  }

  private async find(user: UserRow, name: string): Promise<PersonTime> {
    const people = groupPeople(await this.repo.speakerTime(user.id, null), user.name);
    const person = people.get(personKey(name));
    if (!person) throw new NotFoundException('Person not found');
    return person;
  }
}

/** Topic tags of a person's meetings, most frequent first. */
export function topicCounts(person: PersonTime): FacetCount[] {
  const counts = new Map<string, number>();
  for (const m of person.meetings) for (const t of new Set(m.topics)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
