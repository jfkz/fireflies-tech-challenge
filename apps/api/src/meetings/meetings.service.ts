import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  canTransition,
  type CompleteMeetingRequest,
  type CreateMeetingRequest,
  type ListMeetingsQuery,
  speakerName,
  type MeetingDetail,
  type MeetingFacets,
  type MeetingStats,
  type MeetingStatsQuery,
  type MeetingPage,
  type MeetingStatus,
  type TranscriptUpload,
  type UpdateMeetingRequest,
  type UploadUrlRequest,
  type UploadUrlResponse,
} from '@boringtalks/shared';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { validationError } from '../common/zod.pipe';
import type { MeetingRow, UserRow } from '../db/schema';
import { JobsService } from '../queues/jobs.service';
import { audioKey, meetingPrefix } from '../storage/keys';
import { StorageService, UPLOAD_URL_TTL_SEC } from '../storage/storage.service';
import { displayNames, renameSpeakers } from '../processing/speaker-names';
import { defaultTitle, toDetail, toListItem } from './meeting.mapper';
import { MeetingsRepository } from './meetings.repository';
import { TranscriptService } from './transcript.service';

/** An IANA zone both Node and Postgres understand ("Europe/Berlin", "UTC"). */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz);
  } catch {
    return false;
  }
}

/** How many speakers and topics the filter bar offers. */
const FACETS_LIMIT = 24;

/** Statuses from which a recording may be completed; anything else was completed already. */
const COMPLETABLE: readonly MeetingStatus[] = ['recording', 'uploaded', 'failed'];

/** Statuses in which the client may still change the transcript or the audio. */
const EDITABLE: readonly MeetingStatus[] = ['recording', 'uploaded', 'ready', 'failed'];

/** Can a meeting in `from` start a run at `to`, possibly through `uploaded`? */
export function canStart(from: MeetingStatus, to: 'transcribing' | 'summarizing'): boolean {
  return canTransition(from, to) || (canTransition(from, 'uploaded') && canTransition('uploaded', to));
}

@Injectable()
export class MeetingsService {
  constructor(
    private readonly repo: MeetingsRepository,
    private readonly transcripts: TranscriptService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
  ) {}

  async list(user: UserRow, query: ListMeetingsQuery): Promise<MeetingPage> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !cursor) throw validationError([{ path: 'cursor', message: 'Invalid cursor' }]);
    const rows = await this.repo.list(user.id, {
      cursor,
      limit: query.limit + 1,
      q: query.q || undefined,
      speaker: query.speaker,
      topic: query.topic,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => toListItem(r, r.actionItemCount, r.match)),
      nextCursor: rows.length > query.limit && last ? encodeCursor({ startedAt: last.startedAt, id: last.id }) : null,
    };
  }

  /**
   * Creates a meeting. With an idempotency key, a repeated request (e.g. a retry
   * after a lost response) returns the meeting the first one created.
   */
  async create(user: UserRow, body: CreateMeetingRequest, clientKey?: string): Promise<{ meeting: MeetingDetail; created: boolean }> {
    const startedAt = body.startedAt ? new Date(body.startedAt) : new Date();
    const values = {
      userId: user.id,
      title: body.title || defaultTitle(startedAt),
      titleLocked: Boolean(body.title),
      status: 'recording' as const,
      source: body.source,
      startedAt,
      language: body.language ?? null,
    };
    if (!clientKey) return { meeting: toDetail(await this.repo.create(values), null, [], null), created: true };

    const existing = await this.repo.findByClientKey(user.id, clientKey);
    if (existing) return { meeting: await this.detail(existing), created: false };
    const row = await this.repo.createOnce({ ...values, clientKey });
    if (row) return { meeting: toDetail(row, null, [], null), created: true };
    // A parallel request with the same key won the insert.
    const winner = await this.repo.findByClientKey(user.id, clientKey);
    if (!winner) throw new ConflictException('Could not create the meeting; try again');
    return { meeting: await this.detail(winner), created: false };
  }

  /** Meetings and time spent per day, for the calendar. */
  async stats(user: UserRow, query: MeetingStatsQuery): Promise<MeetingStats> {
    if (!isTimeZone(query.tz)) throw validationError([{ path: 'tz', message: 'Unknown time zone' }]);
    return { tz: query.tz, days: await this.repo.dailyStats(user.id, query.from, query.to, query.tz) };
  }

  /** The speakers and topics a user's meetings have, most frequent first, for the filter bar. */
  facets(user: UserRow): Promise<MeetingFacets> {
    return this.repo.facets(user.id, FACETS_LIMIT);
  }

  async get(user: UserRow, id: string): Promise<MeetingDetail> {
    return this.detail(await this.owned(user, id));
  }

  async update(user: UserRow, id: string, body: UpdateMeetingRequest): Promise<MeetingDetail> {
    let meeting = await this.owned(user, id);
    if (body.actionItem) {
      const found = await this.repo.setActionItemDone(meeting.id, body.actionItem.id, body.actionItem.done);
      if (!found) throw new NotFoundException('Action item not found');
    }
    if (body.speakers) {
      const labels = await this.repo.speakerLabels(meeting.id);
      const renamed = renameSpeakers(labels, meeting.speakerNames, body.speakers);
      if (!renamed) throw new NotFoundException('Speaker not found');
      const names = displayNames(renamed.map);
      meeting = await this.repo.saveSpeakerNames(
        meeting.id,
        renamed.map,
        // The same person named twice (one voice split in two) shows up once.
        [...new Set(labels.map((l) => speakerName(l, names)))],
        renamed.changes,
      );
    }
    if (body.title !== undefined) {
      meeting = (await this.repo.update(meeting.id, { title: body.title, titleLocked: true })) ?? meeting;
    }
    if (body.chain === null) {
      meeting = await this.repo.leaveChain(meeting.id);
    } else if (body.chain) {
      const target = await this.owned(user, body.chain.with);
      if (target.id === meeting.id) throw validationError([{ path: 'chain.with', message: 'A meeting cannot be chained to itself' }]);
      meeting = await this.repo.joinChain(meeting.id, target.id, { reason: null, locked: true });
    }
    return this.detail(meeting);
  }

  async remove(user: UserRow, id: string): Promise<void> {
    const meeting = await this.owned(user, id);
    await this.storage.deletePrefix(meetingPrefix(meeting.userId, meeting.id));
    await this.repo.delete(meeting.id);
  }

  async uploadUrl(user: UserRow, id: string, body: UploadUrlRequest): Promise<UploadUrlResponse> {
    const meeting = await this.owned(user, id);
    this.assertEditable(meeting);
    const key = audioKey(meeting.userId, meeting.id, body.contentType);
    const url = await this.storage.presignPut(key, body.contentType);
    await this.repo.update(meeting.id, { audioKey: key, audioContentType: body.contentType, hasAudio: false });
    return { url, key, headers: { 'Content-Type': body.contentType }, expiresInSec: UPLOAD_URL_TTL_SEC };
  }

  async putTranscript(user: UserRow, id: string, body: TranscriptUpload): Promise<void> {
    const meeting = await this.owned(user, id);
    this.assertEditable(meeting);
    await this.transcripts.store(meeting, body);
  }

  /** The recording is over: summarize the transcript, or transcribe the audio first. */
  async complete(user: UserRow, id: string, body: CompleteMeetingRequest): Promise<MeetingDetail> {
    const meeting = await this.owned(user, id);
    if (!COMPLETABLE.includes(meeting.status)) {
      throw new ConflictException(`The meeting was already completed (it is ${meeting.status})`);
    }
    return this.detail(await this.startProcessing(meeting, body.durationSec));
  }

  /**
   * Runs the pipeline again. A meeting the server transcribed (browser recording, upload) starts
   * from its audio, so transcription improvements (telling voices apart) reach it; a Mac recording
   * keeps its transcript and is summarized again.
   */
  async reprocess(user: UserRow, id: string): Promise<MeetingDetail> {
    const meeting = await this.owned(user, id);
    return this.detail(await this.startProcessing(meeting, undefined, meeting.source === 'browser' || meeting.source === 'upload'));
  }

  private async startProcessing(meeting: MeetingRow, durationSec?: number, fromAudio = false): Promise<MeetingRow> {
    const audio = meeting.audioKey ? await this.storage.head(meeting.audioKey) : null;
    const hasTranscript = await this.repo.hasSegments(meeting.id);
    if (!hasTranscript && !audio) {
      throw new UnprocessableEntityException('Upload a transcript or an audio file first');
    }
    const target = hasTranscript && !(fromAudio && audio) ? 'summarizing' : 'transcribing';
    if (!canStart(meeting.status, target)) {
      throw new ConflictException(`A meeting that is ${meeting.status} cannot move to ${target}`);
    }
    const patch = { hasAudio: Boolean(audio), ...(durationSec !== undefined ? { durationSec } : {}) };
    const started = await this.repo.startRun(meeting.id, meeting.status, target, patch);
    if (!started) throw new ConflictException('The meeting changed while starting; try again');
    if (target === 'summarizing') await this.jobs.summarize(started.id, started.attempts);
    else await this.jobs.transcribe(started.id, started.attempts);
    return started;
  }

  private assertEditable(meeting: MeetingRow): void {
    if (!EDITABLE.includes(meeting.status)) {
      throw new ConflictException(`The meeting is ${meeting.status}; wait until processing finishes`);
    }
  }

  private async owned(user: UserRow, id: string): Promise<MeetingRow> {
    const meeting = await this.repo.findOwned(user.id, id);
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }

  private async detail(meeting: MeetingRow): Promise<MeetingDetail> {
    const [summary, segments, audioUrl, chained] = await Promise.all([
      this.repo.getSummary(meeting.id),
      this.repo.getSegments(meeting.id),
      meeting.hasAudio && meeting.audioKey ? this.storage.presignGet(meeting.audioKey) : Promise.resolve(null),
      meeting.chainId ? this.repo.chainMeetings(meeting.userId, meeting.chainId) : Promise.resolve([]),
    ]);
    const chain = meeting.chainId && chained.length >= 2 ? { id: meeting.chainId, meetings: chained, reason: meeting.chainReason } : null;
    return toDetail(meeting, summary, segments, audioUrl, chain);
  }
}
