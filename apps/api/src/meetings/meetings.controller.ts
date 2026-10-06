import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  CompleteMeetingRequest,
  CreateMeetingRequest,
  ListMeetingsQuery,
  TranscriptUpload,
  UpdateMeetingRequest,
  UploadUrlRequest,
  type MeetingDetail,
  type MeetingFacets,
  type MeetingPage,
  type UploadUrlResponse,
} from '@boringtalks/shared';
import type { Response } from 'express';
import { CurrentUser } from '../auth/auth.decorators';
import { IdempotencyKey } from '../common/idempotency-key';
import { ZodPipe } from '../common/zod.pipe';
import type { UserRow } from '../db/schema';
import { MeetingsService } from './meetings.service';

const MeetingId = () => Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 }));

@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  list(@CurrentUser() user: UserRow, @Query(new ZodPipe(ListMeetingsQuery)) query: ListMeetingsQuery): Promise<MeetingPage> {
    return this.meetings.list(user, query);
  }

  /** Speakers and topics to filter by. Declared before `:id` so "facets" isn't taken for an id. */
  @Get('facets')
  facets(@CurrentUser() user: UserRow): Promise<MeetingFacets> {
    return this.meetings.facets(user);
  }

  /** 201 for a new meeting; 200 with the existing one when the Idempotency-Key was used before. */
  @Post()
  async create(
    @CurrentUser() user: UserRow,
    @Body(new ZodPipe(CreateMeetingRequest)) body: CreateMeetingRequest,
    @IdempotencyKey() clientKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeetingDetail> {
    const { meeting, created } = await this.meetings.create(user, body, clientKey);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return meeting;
  }

  @Get(':id')
  get(@CurrentUser() user: UserRow, @MeetingId() id: string): Promise<MeetingDetail> {
    return this.meetings.get(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: UserRow,
    @MeetingId() id: string,
    @Body(new ZodPipe(UpdateMeetingRequest)) body: UpdateMeetingRequest,
  ): Promise<MeetingDetail> {
    return this.meetings.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: UserRow, @MeetingId() id: string): Promise<void> {
    await this.meetings.remove(user, id);
  }

  @Post(':id/upload-url')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  uploadUrl(
    @CurrentUser() user: UserRow,
    @MeetingId() id: string,
    @Body(new ZodPipe(UploadUrlRequest)) body: UploadUrlRequest,
  ): Promise<UploadUrlResponse> {
    return this.meetings.uploadUrl(user, id, body);
  }

  @Put(':id/transcript')
  @HttpCode(204)
  async putTranscript(
    @CurrentUser() user: UserRow,
    @MeetingId() id: string,
    @Body(new ZodPipe(TranscriptUpload)) body: TranscriptUpload,
  ): Promise<void> {
    await this.meetings.putTranscript(user, id, body);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @CurrentUser() user: UserRow,
    @MeetingId() id: string,
    @Body(new ZodPipe(CompleteMeetingRequest)) body: CompleteMeetingRequest,
  ): Promise<MeetingDetail> {
    return this.meetings.complete(user, id, body);
  }

  @Post(':id/reprocess')
  @HttpCode(200)
  reprocess(@CurrentUser() user: UserRow, @MeetingId() id: string): Promise<MeetingDetail> {
    return this.meetings.reprocess(user, id);
  }
}
