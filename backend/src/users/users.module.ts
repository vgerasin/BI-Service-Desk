import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './user.entity';
import { RateHistory } from './rate-history.entity';
import { ContractorsModule } from '../contractors/contractors.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, RateHistory]), ContractorsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
