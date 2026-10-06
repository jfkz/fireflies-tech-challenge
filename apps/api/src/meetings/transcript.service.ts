import { Injectable } from '@nestjs/common';
import { speakerName, speakersOf, type Segment } from '@boringtalks/shared';
import { displayNames } from '../processing/speaker-names';
import type { MeetingRow } from '../db/schema';
import { transcriptKey } from '../storage/keys';
import { StorageService } from '../storage/storage.service';
import { MeetingsRepository } from './meetings.repository';

export interface TranscriptInput {
  segments: Segment[];
  language?: string | null;
  durationSec?: number | null;
}

/**
 * Stores a transcript: the raw JSON goes to R2 (source of truth), the segments
 * are copied into Postgres for search and the detail view. Used by the upload
 * endpoint and by the transcribe worker.
 */
@Injectable()
export class TranscriptService {
  constructor(
    private readonly repo: MeetingsRepository,
    private readonly storage: StorageService,
  ) {}

  async store(meeting: MeetingRow, input: TranscriptInput): Promise<MeetingRow> {
    const key = transcriptKey(meeting.userId, meeting.id);
    await this.storage.putJson(key, { meetingId: meeting.id, ...input });
    const lastEndSec = Math.ceil(Math.max(0, ...input.segments.map((s) => s.endMs)) / 1000);
    const names = displayNames(meeting.speakerNames);
    return this.repo.replaceTranscript(meeting.id, input.segments, {
      transcriptKey: key,
      speakers: speakersOf(input.segments).map((label) => speakerName(label, names)),
      language: input.language ?? meeting.language,
      durationSec: input.durationSec ?? meeting.durationSec ?? lastEndSec,
    });
  }
}
