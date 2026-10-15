import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contractor } from '../contractors/contractor.entity';
import { BillingCompany } from '../billing-companies/billing-company.entity';
import { TimeEntriesModule } from '../time-entries/time-entries.module';
import { UsersModule } from '../users/users.module';
import { ActsController } from './acts.controller';
import { ActsService } from './acts.service';

@Module({
  imports: [TypeOrmModule.forFeature([Contractor, BillingCompany]), TimeEntriesModule, UsersModule],
  controllers: [ActsController],
  providers: [ActsService],
})
export class ActsModule {}
