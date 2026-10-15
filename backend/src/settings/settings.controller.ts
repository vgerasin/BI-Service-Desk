import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';
import { SettingsService } from './settings.service';
import { TelegramService } from './telegram.service';
import { IntegrationsService } from './integrations.service';
import {
  TELEGRAM_MODULES, telegramSettingKey, telegramScheduleKey, isModuleEnabled, getModuleSchedule, ModuleSchedule,
} from './telegram-modules';

@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly telegram: TelegramService,
    private readonly integrations: IntegrationsService,
  ) {}

  @Get('telegram')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async getTelegramConfig() {
    const moduleKeys = TELEGRAM_MODULES.map(m => telegramSettingKey(m.id));
    const scheduleKeys = TELEGRAM_MODULES.map(m => telegramScheduleKey(m.id));
    const values = await this.settings.getMany([
      'telegram_bot_token', 'telegram_chat_id', 'telegram_thread_id', 'telegram_proxy_url',
      ...moduleKeys, ...scheduleKeys,
    ]);
    const refreshOn = (await this.integrations.getRefresh()).enabled;
    const proxyUrl = values.telegram_proxy_url || process.env.TELEGRAM_PROXY_URL || '';
    return {
      botToken: values.telegram_bot_token || '',
      chatId: values.telegram_chat_id || '',
      threadId: values.telegram_thread_id || '',
      proxyUrl,
      proxyConfigured: !!proxyUrl,
      // «Необновившиеся дашборды» only makes sense when the refresh-monitoring integration is on.
      modules: TELEGRAM_MODULES.filter(m => m.id !== 'dashboard_refresh' || refreshOn).map(m => ({
        id: m.id,
        label: m.label,
        description: m.description,
        enabled: isModuleEnabled(values, m.id),
        schedule: getModuleSchedule(values, m.id),
      })),
    };
  }

  @Post('telegram')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async setTelegramConfig(@Body() body: {
    botToken?: string; chatId?: string; threadId?: string; proxyUrl?: string;
    modules?: Record<string, boolean>; schedules?: Record<string, ModuleSchedule>;
  }) {
    const toSave: Record<string, string | null> = {
      telegram_bot_token: body.botToken?.trim() || null,
      telegram_chat_id: body.chatId?.trim() || null,
      telegram_thread_id: body.threadId?.trim() || null,
      telegram_proxy_url: body.proxyUrl?.trim() || null,
    };
    if (body.modules) {
      for (const m of TELEGRAM_MODULES) {
        if (m.id in body.modules) {
          toSave[telegramSettingKey(m.id)] = body.modules[m.id] ? '1' : '0';
        }
      }
    }
    if (body.schedules) {
      for (const m of TELEGRAM_MODULES) {
        const s = body.schedules[m.id];
        if (s && Array.isArray(s.days) && typeof s.time === 'string') {
          toSave[telegramScheduleKey(m.id)] = JSON.stringify({ days: s.days, time: s.time });
        }
      }
    }
    await this.settings.setMany(toSave);
    return { success: true };
  }

  @Post('telegram/test')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async testTelegram() {
    return this.telegram.send('🔔 Тестовое сообщение. Telegram-уведомления настроены верно.');
  }

  // Superseded by the billing-companies module — acts now pull "Заказчик" requisites per
  // legal entity from there instead of one global settings row (see acts.service.ts).
}
