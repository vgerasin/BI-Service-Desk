import { Module } from '@nestjs/common';
import { DashboardRefreshLogsController } from './dashboard-refresh-logs.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [DashboardRefreshLogsController],
})
export class DashboardRefreshLogsModule {}
