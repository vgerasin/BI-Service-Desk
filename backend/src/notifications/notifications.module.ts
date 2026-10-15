import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { InAppNotificationsService } from './in-app-notifications.service';
import { InAppNotificationsController } from './in-app-notifications.controller';
import { SmtpTestController } from './smtp-test.controller';
import { InAppNotification } from './in-app-notification.entity';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [TypeOrmModule.forFeature([InAppNotification]), SettingsModule],
  controllers: [InAppNotificationsController, SmtpTestController],
  providers: [NotificationsService, InAppNotificationsService],
  exports: [NotificationsService, InAppNotificationsService],
})
export class NotificationsModule {}
