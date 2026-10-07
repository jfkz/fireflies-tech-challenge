import { BadGatewayException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { BotStatus, MeetingDetail, SendBotRequest } from '@boringtalks/shared';
import { AppConfig } from '../config/config.module';
import type { MeetingRow, UserRow } from '../db/schema';
import { defaultTitle, toDetail } from '../meetings/meeting.mapper';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { JobsService } from '../queues/jobs.service';
import { RecallClient, RecallError } from './recall.client';
import { botFailureMessage, botStatusFor } from './recall-webhook';

/** Bot statuses after which the bot is out of the call. */
const GONE: readonly BotStatus[] = ['left', 'done', 'failed'];

export interface RecallWebhook {
  event: string;
  data?: { bot?: { id?: string }; data?: { code?: string; sub_code?: string | null } };
}

/** Sending a Recall.ai bot to a meeting, following it through webhooks, and calling it back. */
@Injectable()
export class BotsService {
  private readonly logger = new Logger(BotsService.name);

  constructor(
    private readonly repo: MeetingsRepository,
    private readonly recall: RecallClient,
    private readonly jobs: JobsService,
    private readonly config: AppConfig,
  ) {}

  /** Creates a meeting and a bot that joins the call (now, or at `joinAt`) to record it. */
  async send(user: UserRow, body: SendBotRequest): Promise<MeetingDetail> {
    if (!this.recall.enabled) throw new ServiceUnavailableException('Meeting bots are not set up on this server');
    const joinAt = body.joinAt ? new Date(body.joinAt) : null;
    const startedAt = joinAt && joinAt > new Date() ? joinAt : new Date();
    const meeting = await this.repo.create({
      userId: user.id,
      title: body.title || defaultTitle(startedAt),
      titleLocked: Boolean(body.title),
      status: 'recording',
      source: 'bot',
      startedAt,
      botMeetingUrl: body.meetingUrl,
      botJoinAt: joinAt,
      botStatus: joinAt ? 'scheduled' : 'joining',
    });
    try {
      const bot = await this.recall.createBot({
        meetingUrl: body.meetingUrl,
        joinAt: joinAt ?? undefined,
        metadata: { meeting_id: meeting.id, env: this.config.env.NODE_ENV },
      });
      const row = await this.repo.update(meeting.id, { botId: bot.id });
      return toDetail(row ?? meeting, null, [], null);
    } catch (err) {
      await this.repo.delete(meeting.id);
      if (err instanceof RecallError && err.status < 500) throw new BadGatewayException(`The bot can’t join: ${err.message}`);
      throw new BadGatewayException('Couldn’t reach the meeting bot service; try again in a minute');
    }
  }

  /** Calls the bot out of the call; what it recorded so far is still turned into notes. */
  async leave(user: UserRow, meetingId: string): Promise<MeetingDetail> {
    const meeting = await this.repo.findOwned(user.id, meetingId);
    if (!meeting?.botId) throw new NotFoundException('This meeting has no bot');
    if (meeting.botStatus && GONE.includes(meeting.botStatus)) throw new ConflictException('The bot already left');
    await this.recall.leaveCall(meeting.botId);
    const row = await this.repo.update(meeting.id, { botStatus: 'left' });
    return toDetail(row ?? meeting, null, [], null);
  }

  /** Recall's bot status webhooks: keep the meeting's bot status, and import the recording when done. */
  async handleWebhook(payload: RecallWebhook): Promise<void> {
    const botId = payload.data?.bot?.id;
    const status = botStatusFor(payload.event);
    if (!botId || !status) return;
    const meeting = await this.repo.findByBotId(botId);
    if (!meeting) {
      // Bots of another environment share the Recall workspace; not ours to handle.
      this.logger.log({ botId, event: payload.event }, 'webhook for an unknown bot');
      return;
    }
    if (meeting.botStatus === 'done' || meeting.botStatus === 'failed') return;
    if (status === 'failed') {
      const message = botFailureMessage(payload.event, payload.data?.data?.sub_code);
      await this.repo.update(meeting.id, { botStatus: 'failed' });
      await this.repo.transition(meeting.id, 'recording', { status: 'failed', error: message });
      return;
    }
    await this.repo.update(meeting.id, { botStatus: status });
    if (status === 'done') await this.startImport(meeting);
  }

  private async startImport(meeting: MeetingRow): Promise<void> {
    if (meeting.status !== 'recording') return;
    await this.jobs.importBot(meeting.id, meeting.attempts);
  }
}
