import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Setting } from './setting.entity';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';
import { TelegramService } from './telegram.service';
import { User } from '../users/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Setting, User])],
  providers: [SettingsService, IntegrationsService, TelegramService],
  controllers: [SettingsController, IntegrationsController],
  exports: [SettingsService, IntegrationsService, TelegramService],
})
export class SettingsModule {}
