import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ListProblemReportsQuery,
  ProblemReportRequest,
  type ProblemReportDetail,
  type ProblemReportPage,
  type ProblemReportResponse,
} from '@boringtalks/shared';
import { AdminOnly, CurrentDeviceId, CurrentUser } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { UserRow } from '../db/schema';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** "Report a Problem…" from the Mac app (a device token), or any signed-in client. */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  create(
    @CurrentUser() user: UserRow,
    @CurrentDeviceId() deviceId: string | null,
    @Body(new ZodPipe(ProblemReportRequest)) body: ProblemReportRequest,
  ): Promise<ProblemReportResponse> {
    return this.reports.create(user, deviceId, body);
  }
}

/** Every user's reports, for the people in ADMIN_EMAILS. */
@Controller('admin/reports')
@AdminOnly()
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@Query(new ZodPipe(ListProblemReportsQuery)) query: ListProblemReportsQuery): Promise<ProblemReportPage> {
    return this.reports.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ProblemReportDetail> {
    return this.reports.get(id);
  }
}
