import { Injectable } from '@nestjs/common';
import { speakerName, speakersOf } from '@boringtalks/shared';
import type { SpeakerNameMap } from '../db/schema';
import { displayNames, resolveSpeakerNames } from '../processing/speaker-names';
import { DEMO_MEETING, DEMO_SEGMENTS } from './demo-meeting';
import { MeetingsRepository } from './meetings.repository';

/** "Thu, Oct 8": how the demo's deadlines read, as if someone said them. */
const DUE_FORMAT = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

@Injectable()
export class DemoService {
  constructor(private readonly repo: MeetingsRepository) {}

  /** Adds the ready-made demo meeting to a new account; "You" in it gets the account holder's first name. */
  async seed(userId: string, now = new Date(), ownerName: string | null = null): Promise<string> {
    const startedAt = new Date(now.getTime() - 24 * 3600 * 1000);
    startedAt.setUTCMinutes(0, 0, 0);
    const labels = speakersOf(DEMO_SEGMENTS);
    const speakerNames: SpeakerNameMap = resolveSpeakerNames(labels, [], ownerName);
    const names = displayNames(speakerNames);
    const meeting = await this.repo.create({
      userId,
      title: DEMO_MEETING.title,
      description: DEMO_MEETING.description,
      status: 'ready',
      source: 'demo',
      startedAt,
      durationSec: DEMO_MEETING.durationSec,
      language: DEMO_MEETING.language,
      speakers: labels.map((l) => speakerName(l, names)),
      speakerNames,
      topics: DEMO_MEETING.topics,
    });
    await this.repo.replaceTranscript(meeting.id, DEMO_SEGMENTS, {});
    await this.repo.saveSummary(
      meeting.id,
      {
        summary: DEMO_MEETING.summary,
        keyTopics: DEMO_MEETING.keyTopics,
        actionItems: DEMO_MEETING.actionItems.map(({ dueInDays, ...a }) => {
          const due = dueInDays === null ? null : new Date(startedAt.getTime() + dueInDays * 86_400_000);
          return { ...a, owner: speakerName(a.owner, names), due: due && DUE_FORMAT.format(due), dueDate: due && due.toISOString().slice(0, 10) };
        }),
        decisions: DEMO_MEETING.decisions,
        model: 'demo',
        inputTokens: null,
        outputTokens: null,
      },
      {},
    );
    return meeting.id;
  }
}
