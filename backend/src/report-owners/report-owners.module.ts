import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportOwner } from './report-owner.entity';
import { ReportOwnersService } from './report-owners.service';
import { ReportOwnersController } from './report-owners.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ReportOwner])],
  controllers: [ReportOwnersController],
  providers: [ReportOwnersService],
  exports: [ReportOwnersService],
})
export class ReportOwnersModule {}
