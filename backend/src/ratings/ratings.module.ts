import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RatingsController } from './ratings.controller';
import { RatingsService } from './ratings.service';
import { RequestRating } from './request-rating.entity';
import { ResolveRequestIdPipe } from '../requests/resolve-request-id.pipe';

@Module({
  imports: [TypeOrmModule.forFeature([RequestRating])],
  controllers: [RatingsController],
  // ResolveRequestIdPipe only depends on DataSource, not on RequestsService — provided directly
  // here (rather than importing RequestsModule) because RequestsModule already imports
  // RatingsModule, and the reverse import would be circular.
  providers: [RatingsService, ResolveRequestIdPipe],
  exports: [RatingsService],
})
export class RatingsModule {}
