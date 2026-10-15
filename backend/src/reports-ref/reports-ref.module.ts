import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsRefController } from './reports-ref.controller';
import { ReportsRefService } from './reports-ref.service';
import { ReportRef } from './report-ref.entity';
import { ReportVersion } from './report-version.entity';
import { ReportStatusHistory } from './report-status-history.entity';
import { DataSource } from '../data-sources/data-source.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ReportRef, ReportVersion, ReportStatusHistory, DataSource])],
  controllers: [ReportsRefController],
  providers: [ReportsRefService],
  exports: [ReportsRefService],
})
export class ReportsRefModule {}
