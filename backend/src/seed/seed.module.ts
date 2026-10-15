import { Module } from '@nestjs/common';
import { SeedService } from './seed.service';
import { SeedController } from './seed.controller';
import { UsersModule } from '../users/users.module';
import { CustomersModule } from '../customers/customers.module';
import { ContractorsModule } from '../contractors/contractors.module';
import { DictionariesModule } from '../dictionaries/dictionaries.module';
import { DataSourcesModule } from '../data-sources/data-sources.module';
import { ReportsRefModule } from '../reports-ref/reports-ref.module';
import { RequestsModule } from '../requests/requests.module';
import { TimeEntriesModule } from '../time-entries/time-entries.module';
import { RatingsModule } from '../ratings/ratings.module';
import { KnownErrorsModule } from '../known-errors/known-errors.module';

@Module({
  imports: [
    UsersModule, CustomersModule, ContractorsModule, DictionariesModule, DataSourcesModule,
    ReportsRefModule, RequestsModule, TimeEntriesModule, RatingsModule, KnownErrorsModule,
  ],
  providers: [SeedService],
  controllers: [SeedController],
  exports: [SeedService],
})
export class SeedModule {}
