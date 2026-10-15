import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnownError } from './known-error.entity';
import { KnownErrorsService } from './known-errors.service';
import { KnownErrorsController } from './known-errors.controller';
import { ResolveRequestIdPipe } from '../requests/resolve-request-id.pipe';

@Module({
  imports: [TypeOrmModule.forFeature([KnownError])],
  providers: [KnownErrorsService, ResolveRequestIdPipe],
  controllers: [KnownErrorsController],
  exports: [KnownErrorsService],
})
export class KnownErrorsModule {}
