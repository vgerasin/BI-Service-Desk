import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { User } from '../users/user.entity';
import { Customer } from '../customers/customer.entity';
import { Contractor } from '../contractors/contractor.entity';
import { Dictionary } from '../dictionaries/dictionary.entity';
import { ReportRef } from '../reports-ref/report-ref.entity';
import { BiRequest } from '../requests/request.entity';
import { TimeEntry } from '../time-entries/time-entry.entity';
import { Artifact } from '../requests/artifact.entity';
import { Activity } from '../requests/activity.entity';
import { RateHistory } from '../users/rate-history.entity';
import { RequestRating } from '../ratings/request-rating.entity';
import { BillingCompany } from '../billing-companies/billing-company.entity';
import { KnownError } from '../known-errors/known-error.entity';
import { DataSource as DataSourceEntity } from '../data-sources/data-source.entity';
import { ReportOwner } from '../report-owners/report-owner.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, Customer, Contractor, Dictionary, ReportRef,
      BiRequest, TimeEntry, Artifact, Activity, RateHistory, RequestRating,
      BillingCompany, KnownError, DataSourceEntity, ReportOwner,
    ]),
    MulterModule.register({ limits: { fileSize: 100 * 1024 * 1024 } }),
  ],
  controllers: [BackupController],
  providers: [BackupService],
})
export class BackupModule {}
