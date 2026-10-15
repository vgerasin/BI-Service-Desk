import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingCompany } from './billing-company.entity';
import { BillingCompaniesService } from './billing-companies.service';
import { BillingCompaniesController } from './billing-companies.controller';

@Module({
  imports: [TypeOrmModule.forFeature([BillingCompany])],
  providers: [BillingCompaniesService],
  controllers: [BillingCompaniesController],
  exports: [TypeOrmModule],
})
export class BillingCompaniesModule {}
