import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractorsController } from './contractors.controller';
import { ContractorsService } from './contractors.service';
import { Contractor } from './contractor.entity';
import { RateHistory } from '../users/rate-history.entity';
import { User } from '../users/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Contractor, RateHistory, User])],
  controllers: [ContractorsController],
  providers: [ContractorsService],
  exports: [ContractorsService],
})
export class ContractorsModule {}
