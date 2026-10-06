import { BadRequestException, Body, Controller, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SendBotRequest, type MeetingDetail } from '@boringtalks/shared';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, Public } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AppConfig } from '../config/config.module';
import type { UserRow } from '../db/schema';
import { BotsService, type RecallWebhook } from './bots.service';
import { verifyRecallWebhook } from './recall-webhook';

@Controller()
export class BotsController {
  constructor(
    private readonly bots: BotsService,
    private readonly config: AppConfig,
  ) {}

  /** Sends a bot to a Zoom, Meet, Teams or Webex link; returns the new meeting. */
  @Post('bots')
  send(@CurrentUser() user: UserRow, @Body(new ZodPipe(SendBotRequest)) body: SendBotRequest): Promise<MeetingDetail> {
    return this.bots.send(user, body);
  }

  @Post('meetings/:id/bot/leave')
  @HttpCode(200)
  leave(@CurrentUser() user: UserRow, @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string): Promise<MeetingDetail> {
    return this.bots.leave(user, id);
  }

  /** Recall.ai's bot status webhooks, signed with the workspace secret. */
  @Public()
  @SkipThrottle()
  @Post('integrations/recall/webhook')
  @HttpCode(204)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers() headers: Record<string, string>): Promise<void> {
    const secret = this.config.env.RECALL_WEBHOOK_SECRET;
    const raw = req.rawBody?.toString('utf8');
    if (!secret || !raw || !verifyRecallWebhook(secret, headers, raw)) throw new UnauthorizedException('Invalid webhook signature');
    let payload: RecallWebhook;
    try {
      payload = JSON.parse(raw) as RecallWebhook;
    } catch {
      throw new BadRequestException('Invalid JSON');
    }
    await this.bots.handleWebhook(payload);
  }
}
