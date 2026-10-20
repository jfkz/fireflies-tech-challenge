import { Global, Module } from '@nestjs/common';
import { AppSettingsRepository } from './app-settings.repository';
import { AppSettingsService } from './app-settings.service';

@Global()
@Module({
  providers: [AppSettingsRepository, AppSettingsService],
  exports: [AppSettingsService],
})
export class AppSettingsModule {}
