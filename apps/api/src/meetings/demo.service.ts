import { Injectable } from '@nestjs/common';
import { speakersOf } from '@boringtalks/shared';
import { DEMO_MEETING, DEMO_SEGMENTS } from './demo-meeting';
import { MeetingsRepository } from './meetings.repository';

@Injectable()
export class DemoService {
  constructor(private readonly repo: MeetingsRepository) {}

  /** Adds the ready-made demo meeting to a new account. */
  async seed(userId: string, now = new Date()): Promise<string> {
    const startedAt = new Date(now.getTime() - 24 * 3600 * 1000);
    startedAt.setUTCMinutes(0, 0, 0);
    const meeting = await this.repo.create({
      userId,
      title: DEMO_MEETING.title,
      description: DEMO_MEETING.description,
      status: 'ready',
      source: 'demo',
      startedAt,
      durationSec: DEMO_MEETING.durationSec,
      language: DEMO_MEETING.language,
      speakers: speakersOf(DEMO_SEGMENTS),
    });
    await this.repo.replaceTranscript(meeting.id, DEMO_SEGMENTS, {});
    await this.repo.saveSummary(
      meeting.id,
      {
        summary: DEMO_MEETING.summary,
        keyTopics: DEMO_MEETING.keyTopics,
        actionItems: DEMO_MEETING.actionItems,
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
