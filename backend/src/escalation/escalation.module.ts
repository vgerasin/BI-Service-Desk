import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EscalationService } from './escalation.service';
import { EscalationController } from './escalation.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [ScheduleModule.forRoot(), NotificationsModule, SettingsModule],
  controllers: [EscalationController],
  providers: [EscalationService],
  exports: [EscalationService],
})
export class EscalationModule {}
