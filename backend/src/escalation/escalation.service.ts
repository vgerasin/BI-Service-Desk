import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramService } from '../settings/telegram.service';
import { SettingsService } from '../settings/settings.service';
import { TELEGRAM_MODULES, telegramScheduleKey, getModuleSchedule } from '../settings/telegram-modules';
import { getAppUrl } from '../common/app-config';
import { IntegrationsService } from '../settings/integrations.service';

const MSK = { timeZone: 'Europe/Moscow' };

// Returned by each check so a manual "test send" (see EscalationController) can tell the
// admin *why* nothing arrived — "no matching data right now" is not the same as a failure.
export interface CheckResult { found: boolean; sent?: boolean; error?: string; }

const CHECK_METHOD: Record<string, keyof EscalationService> = {
  sla_breach: 'checkSlaBreaches',
  sla_near: 'checkNearBreaches',
  dashboard_refresh: 'checkDashboardRefreshFailures',
  stale_new: 'checkStaleNewRequests',
  daily_digest: 'checkDailyDigest',
};

// Raw refresh-log status strings look like "Data Refresh failed, contact the administrator,
// SessionId: 7b889fe7-...", which is noisy for a Telegram message — the SessionId is only
// useful for support tickets, not at-a-glance triage. Strip it and pick an icon by outcome.
function formatRefreshStatus(raw: string): { icon: string; text: string } {
  const text = raw.split(/,?\s*SessionId:/i)[0].trim();
  const lower = text.toLowerCase();
  if (lower.includes('fail') || lower.includes('error') || lower.includes('ошиб')) return { icon: '🔴', text };
  if (lower.includes('refresh') || lower.includes('progress') || lower.includes('обновл')) return { icon: '🟡', text };
  return { icon: '⚪', text };
}

// Shared list rendering for Telegram messages — bold title line + detail line per item,
// separated by a blank line (matches the "Не обновились сегодня" formatting).
function formatItemList(items: { icon: string; title: string; detail: string }[]): string {
  return items.map(i => `${i.icon} <b>${i.title}</b>\n${i.detail}`).join('\n\n');
}

function nowInMoscow(): { day: number; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const weekday = parts.find(p => p.type === 'weekday')!.value;
  const hour = parts.find(p => p.type === 'hour')!.value.padStart(2, '0').slice(-2);
  const minute = parts.find(p => p.type === 'minute')!.value;
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { day: dayMap[weekday], time: `${hour}:${minute}` };
}

@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    private readonly telegram: TelegramService,
    private readonly settings: SettingsService,
    private readonly integrations: IntegrationsService,
  ) {}

  // Single master tick (every minute, MSK) dispatching each module against its own
  // admin-configurable schedule (see Settings → Уведомления в Telegram), instead of one
  // hardcoded @Cron per module — lets schedule edits take effect without a redeploy.
  @Cron('* * * * *', MSK)
  async tick(): Promise<void> {
    // The local dev DB is sometimes a restored production snapshot (real users, real overdue
    // requests), so this must never fire during local testing — otherwise a local `npm run
    // start:dev` silently emails/telegrams real people with stale data (incident 2026-08-03).
    // NOT gated on NODE_ENV: this deployment's production env has no NODE_ENV set at all, so
    // that check disabled the cron in production too. Opt out explicitly when running locally
    // against a real data snapshot: DISABLE_SCHEDULED_JOBS=1 npm run start:dev
    if (process.env.DISABLE_SCHEDULED_JOBS === '1') return;

    const { day, time } = nowInMoscow();
    const keys = TELEGRAM_MODULES.map(m => telegramScheduleKey(m.id));
    const values = await this.settings.getMany(keys);

    for (const m of TELEGRAM_MODULES) {
      const schedule = getModuleSchedule(values, m.id);
      if (!schedule.days.includes(day) || schedule.time !== time) continue;
      const methodName = CHECK_METHOD[m.id];
      if (!methodName) continue;
      try {
        await (this[methodName] as () => Promise<CheckResult>).call(this);
      } catch (e) {
        this.logger.error(`Плановая проверка "${m.id}" завершилась с ошибкой: ${e.message}`);
      }
    }
  }

  async checkSlaBreaches(): Promise<CheckResult> {
    this.logger.log('Запуск проверки нарушений SLA...');
    const today = new Date().toISOString().split('T')[0];

    // Find overdue active requests. Deliberately NOT joined to users here — that used to be
    // `LEFT JOIN users u ON u.role = 'admin' AND u."isActive" = true`, an unconditional join with
    // no per-row correlation, so every request row got duplicated once per active admin (3 admins
    // → each request counted/shown 3×, inflating both the email lists and the Telegram digest's
    // count/preview). Recipients are fetched as their own simple query below instead.
    const overdue = await this.dataSource.query(`
      SELECT
        r.id, r.number, r.name, r.status, r.priority, r."plannedDate",
        r."contractorId",
        c.department AS "customerDept",
        con.name AS "contractorName", con.email AS "contractorEmail",
        DATE_PART('day', NOW() - r."plannedDate"::timestamp) AS "overdueDays"
      FROM requests r
      LEFT JOIN customers c ON c.id = r."customerId"
      LEFT JOIN contractors con ON con.id = r."contractorId"
      WHERE r."plannedDate" < $1
        AND r.status NOT IN ('done', 'rejected', 'cancelled', 'waiting_customer')
        AND r."plannedDate" IS NOT NULL
      ORDER BY r."plannedDate" ASC
      LIMIT 50
    `, [today]);

    if (!overdue.length) {
      this.logger.log('Нарушений SLA не найдено');
      return { found: false };
    }

    const admins = await this.dataSource.query(
      `SELECT "fullName", email FROM users WHERE role = 'admin' AND "isActive" = true AND email IS NOT NULL`,
    );

    const appUrl = getAppUrl();

    for (const admin of admins) {
      await this.notifications.sendSlaEscalation({ to: admin.email, toName: admin.fullName, overdueRequests: overdue, appUrl });
    }

    const preview = formatItemList(overdue.slice(0, 10).map((r: any) => ({
      icon: '🔴',
      title: `${r.number} — ${r.name}`,
      detail: `Просрочено на ${Math.round(r.overdueDays)} дн.`,
    })));
    const res = await this.telegram.sendIfEnabled(
      'sla_breach',
      `⚠️ <b>Нарушение сроков</b>: ${overdue.length} заявок просрочено\n\n${preview}${overdue.length > 10 ? `\n\n…и ещё ${overdue.length - 10}` : ''}`,
    );

    this.logger.log(`Эскалация SLA отправлена, нарушений: ${overdue.length}`);
    return { found: true, sent: res.sent, error: res.error };
  }

  // Near-breach warning: requests expiring in 1-2 days. Schedule configurable in Settings.
  async checkNearBreaches(): Promise<CheckResult> {
    const twoDaysLater = new Date();
    twoDaysLater.setDate(twoDaysLater.getDate() + 2);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Same fix as checkSlaBreaches() above — no join to users here, recipients fetched separately.
    const nearBreach = await this.dataSource.query(`
      SELECT
        r.id, r.number, r.name, r.status, r.priority, r."plannedDate",
        DATE_PART('day', r."plannedDate"::timestamp - NOW()) AS "daysLeft"
      FROM requests r
      WHERE r."plannedDate" BETWEEN $1 AND $2
        AND r.status NOT IN ('done', 'rejected', 'cancelled', 'waiting_customer')
      ORDER BY r."plannedDate" ASC
      LIMIT 30
    `, [tomorrow.toISOString().split('T')[0], twoDaysLater.toISOString().split('T')[0]]);

    if (!nearBreach.length) return { found: false };

    const admins = await this.dataSource.query(
      `SELECT "fullName", email FROM users WHERE role = 'admin' AND "isActive" = true AND email IS NOT NULL`,
    );

    const appUrl = getAppUrl();
    for (const admin of admins) {
      await this.notifications.sendSlaNearBreach({ to: admin.email, toName: admin.fullName, requests: nearBreach, appUrl });
    }

    const preview = formatItemList(nearBreach.slice(0, 10).map((r: any) => ({
      icon: '🟡',
      title: `${r.number} — ${r.name}`,
      detail: `Осталось ${Math.round(r.daysLeft)} дн.`,
    })));
    const res = await this.telegram.sendIfEnabled(
      'sla_near',
      `⏰ <b>Приближается срок исполнения</b>: ${nearBreach.length} заявок\n\n${preview}${nearBreach.length > 10 ? `\n\n…и ещё ${nearBreach.length - 10}` : ''}`,
    );
    return { found: true, sent: res.sent, error: res.error };
  }

  // Dashboards whose last scheduled refresh (fed by the external ingest, see
  // dashboard-refresh-logs.controller.ts) failed today. Schedule configurable in Settings.
  async checkDashboardRefreshFailures(): Promise<CheckResult> {
    if (!(await this.integrations.getRefresh()).enabled) return { found: false };
    const failures = await this.dataSource.query(`
      SELECT
        d."reportName",
        COALESCE(al."reportId", rr.id, d."reportId") AS "reportId",
        (ARRAY_AGG(d."lastStatus" ORDER BY d."checkedAt" DESC))[1] AS "lastStatus",
        COUNT(*)::int AS "failureCount"
      FROM dashboard_refresh_logs d
      LEFT JOIN dashboard_refresh_aliases al ON LOWER(al."sourceName") = LOWER(d."reportName")
      LEFT JOIN reports_ref rr ON LOWER(TRIM(rr.name)) = LOWER(d."reportName")
      WHERE d."checkedAt"::date = CURRENT_DATE
      GROUP BY d."reportName", COALESCE(al."reportId", rr.id, d."reportId")
      ORDER BY d."reportName"
    `);

    if (!failures.length) return { found: false };

    const preview = formatItemList(failures.slice(0, 15).map((f: any) => {
      const { icon, text } = formatRefreshStatus(f.lastStatus);
      return { icon, title: f.reportName, detail: text };
    }));
    const res = await this.telegram.sendIfEnabled(
      'dashboard_refresh',
      `📊 <b>Не обновились сегодня</b>: ${failures.length} дашбордов\n\n${preview}${failures.length > 15 ? `\n\n…и ещё ${failures.length - 15}` : ''}`,
    );
    return { found: true, sent: res.sent, error: res.error };
  }

  // New/queued requests sitting without an assignee or contractor for 2+ days. Schedule configurable in Settings.
  async checkStaleNewRequests(): Promise<CheckResult> {
    const stale = await this.dataSource.query(`
      SELECT r.id, r.number, r.name, r.priority, r."createdAt",
        DATE_PART('day', NOW() - r."createdAt") AS "ageDays"
      FROM requests r
      WHERE r.status IN ('new', 'queued')
        AND r."assigneeId" IS NULL
        AND r."contractorId" IS NULL
        AND r."createdAt" < NOW() - INTERVAL '2 days'
      ORDER BY r."createdAt" ASC
      LIMIT 30
    `);

    if (!stale.length) return { found: false };

    const preview = formatItemList(stale.slice(0, 15).map((r: any) => ({
      icon: '⚪',
      title: `${r.number} — ${r.name}`,
      detail: `${Math.round(r.ageDays)} дн. без исполнителя`,
    })));
    const res = await this.telegram.sendIfEnabled(
      'stale_new',
      `🕳️ <b>Заявки без исполнителя</b>: ${stale.length}\n\n${preview}${stale.length > 15 ? `\n\n…и ещё ${stale.length - 15}` : ''}`,
    );
    return { found: true, sent: res.sent, error: res.error };
  }

  // End-of-day summary. Schedule configurable in Settings.
  async checkDailyDigest(): Promise<CheckResult> {
    const [row] = await this.dataSource.query(`
      SELECT
        COUNT(*) FILTER (WHERE "createdAt"::date = CURRENT_DATE) AS created,
        COUNT(*) FILTER (WHERE "closedAt"::date = CURRENT_DATE AND status = 'done') AS done,
        COUNT(*) FILTER (
          WHERE status NOT IN ('done', 'rejected', 'cancelled', 'waiting_customer')
            AND "plannedDate" IS NOT NULL AND "plannedDate" < CURRENT_DATE
        ) AS overdue,
        COUNT(*) FILTER (WHERE status = 'in_progress') AS "inProgress"
      FROM requests
    `);

    const res = await this.telegram.sendIfEnabled(
      'daily_digest',
      `📋 <b>Сводка за день</b>\n\n` +
      `🆕 Создано: ${row.created}\n` +
      `✅ Выполнено: ${row.done}\n` +
      `🔧 В работе: ${row.inProgress}\n` +
      `🔴 Просрочено: ${row.overdue}`,
    );
    return { found: true, sent: res.sent, error: res.error };
  }
}
