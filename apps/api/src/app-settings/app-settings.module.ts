import { Module } from '@nestjs/common';
import { AppSettingsRepository } from './app-settings.repository';
import { AppSettingsService } from './app-settings.service';

/** Imported where it is used (users for /me, admin), so the API and the worker both resolve it. */
@Module({
  providers: [AppSettingsRepository, AppSettingsService],
  exports: [AppSettingsService],
})
export class AppSettingsModule {}
