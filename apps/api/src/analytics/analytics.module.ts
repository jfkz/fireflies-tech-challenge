import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/config.module';
import { AnalyticsService, createAnalyticsClient } from './analytics.service';

/** Global, and imported by both roots: the API (AppModule) and the worker (WorkerModule). */
@Global()
@Module({
  providers: [{ provide: AnalyticsService, inject: [AppConfig], useFactory: (config: AppConfig) => new AnalyticsService(config, createAnalyticsClient(config)) }],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
