import { BadRequestException, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';
import { SettingsService } from '../settings/settings.service';
import { TelegramService } from '../settings/telegram.service';
import { TELEGRAM_MODULES, telegramSettingKey, isModuleEnabled } from '../settings/telegram-modules';
import { EscalationService, CheckResult } from './escalation.service';

const CHECK_METHOD: Record<string, keyof EscalationService> = {
  sla_breach: 'checkSlaBreaches',
  sla_near: 'checkNearBreaches',
  dashboard_refresh: 'checkDashboardRefreshFailures',
  stale_new: 'checkStaleNewRequests',
  daily_digest: 'checkDailyDigest',
};

// Fed to the admin's Telegram chat when a manual test click finds no real matching data right
// now — otherwise the button would silently do nothing, defeating its purpose ("show me what
// this looks like"). daily_digest never needs this: it always sends, even with all-zero counts.
function sampleText(moduleId: string): string | undefined {
  const samples: Record<string, string> = {
    sla_breach:
      `⚠️ <b>Нарушение сроков</b>: 2 заявок просрочено\n\n` +
      `🔴 <b>REQ-1024 — Доработка отчёта «Продажи»</b>\nПросрочено на 3 дн.\n\n` +
      `🔴 <b>REQ-1031 — Настройка дашборда</b>\nПросрочено на 1 дн.`,
    sla_near:
      `⏰ <b>Приближается срок исполнения</b>: 1 заявок\n\n` +
      `🟡 <b>REQ-1042 — Обновление дашборда «Продажи»</b>\nОсталось 1 дн.`,
    dashboard_refresh:
      `📊 <b>Не обновились сегодня</b>: 1 дашбордов\n\n` +
      `🔴 <b>Продажи — ежедневный отчёт</b>\nData Refresh failed, contact the administrator`,
    stale_new:
      `🕳️ <b>Заявки без исполнителя</b>: 1\n\n` +
      `⚪ <b>REQ-1050 — Новый отчёт по продажам</b>\n3 дн. без исполнителя`,
  };
  return samples[moduleId];
}

// Powers the "Тестовая отправка" button next to each module in Admin → Настройки → Telegram.
// Runs that one check right now instead of waiting for its cron slot, temporarily force-
// enabling it if the admin has it switched off (restored afterward — this previews, it
// doesn't change the saved toggle).
export interface TestResult extends CheckResult { preview: boolean; }

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('escalation')
export class EscalationController {
  constructor(
    private readonly escalation: EscalationService,
    private readonly settings: SettingsService,
    private readonly telegram: TelegramService,
  ) {}

  @Post('test/:moduleId')
  async testModule(@Param('moduleId') moduleId: string): Promise<TestResult> {
    const methodName = CHECK_METHOD[moduleId];
    if (!methodName) throw new BadRequestException(`Неизвестный модуль: ${moduleId}`);

    const key = telegramSettingKey(moduleId);
    const before = await this.settings.getMany([key]);
    const wasEnabled = isModuleEnabled(before, moduleId);

    if (!wasEnabled) await this.settings.set(key, '1');
    let result: CheckResult;
    try {
      result = await (this.escalation[methodName] as () => Promise<CheckResult>).call(this.escalation);
    } finally {
      if (!wasEnabled) await this.settings.set(key, '0');
    }

    if (result.found) return { ...result, preview: false };

    const sample = sampleText(moduleId);
    if (!sample) return { ...result, preview: false };
    const res = await this.telegram.send(`🧪 <i>Пример уведомления — реальных совпадений сейчас нет</i>\n\n${sample}`);
    return { found: false, sent: res.sent, error: res.error, preview: true };
  }
}

// Guards against CHECK_METHOD silently drifting out of sync with the module registry.
for (const m of TELEGRAM_MODULES) {
  if (!CHECK_METHOD[m.id]) throw new Error(`escalation.controller.ts: no check method mapped for module "${m.id}"`);
}
