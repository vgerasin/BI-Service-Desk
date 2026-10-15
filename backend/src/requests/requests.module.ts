import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { ResolveRequestIdPipe } from './resolve-request-id.pipe';
import { BiRequest } from './request.entity';
import { Artifact } from './artifact.entity';
import { Activity } from './activity.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { RatingsModule } from '../ratings/ratings.module';
import { UsersModule } from '../users/users.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BiRequest, Artifact, Activity]),
    NotificationsModule, RatingsModule, UsersModule, SettingsModule,
  ],
  controllers: [RequestsController],
  providers: [RequestsService, ResolveRequestIdPipe],
  exports: [RequestsService],
})
export class RequestsModule {}
