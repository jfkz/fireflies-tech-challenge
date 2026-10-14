import { Module } from '@nestjs/common';
import { AdminReportsController, ReportsController } from './reports.controller';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsRepository, ReportsService],
  exports: [ReportsRepository],
})
export class ReportsModule {}
