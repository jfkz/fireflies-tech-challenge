import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { HealthService, type Health } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** 200 when Postgres and Redis answer, 503 otherwise (Railway's healthcheck). */
  @Get()
  @Public()
  @SkipThrottle()
  async check(@Res({ passthrough: true }) res: Response): Promise<Health> {
    const result = await this.health.check();
    if (result.status !== 'ok') res.status(503);
    return result;
  }
}
