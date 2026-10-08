import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ProblemReportRequest, type ProblemReportResponse } from '@boringtalks/shared';
import { CurrentDeviceId, CurrentUser } from '../auth/auth.decorators';
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
