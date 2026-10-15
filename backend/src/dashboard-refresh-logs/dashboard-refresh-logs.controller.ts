import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, Post, Query, UseGuards,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IntegrationsService } from '../settings/integrations.service';
import { timingSafeEqual } from 'crypto';

interface LogEntry {
  reportName: string;
  lastStatus: string;
}

// The source system may send fields prefixed with "=" (an Excel/CSV export artifact, not part of the name).
const clean = (s: string) => (s ?? '').replace(/^=+\s*/, '').trim();

/**
 * Optional integration (Settings → «Мониторинг обновления дашбордов»). An external job — n8n, a
 * cron script, anything that can send HTTP — pushes one row per report whose last scheduled
 * refresh didn't succeed. Not behind JwtAuthGuard (the job has no user session): it is gated by
 * the shared secret from the settings page, sent in the `x-log-secret` header.
 */
@Controller('dashboard-refresh-logs')
export class DashboardRefreshLogsController {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private readonly integrations: IntegrationsService,
  ) {}

  private async checkSecret(secret: string | undefined) {
    const expected = await this.integrations.getRefreshSecret();
    const cfg = await this.integrations.getRefresh();
    const a = Buffer.from(secret ?? '');
    const b = Buffer.from(expected);
    if (!cfg.enabled || !expected || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException();
    }
  }

  private async matchReportId(reportName: string): Promise<number | null> {
    const alias = await this.dataSource.query(
      `SELECT "reportId" FROM dashboard_refresh_aliases WHERE LOWER("sourceName") = LOWER($1) LIMIT 1`,
      [reportName],
    );
    if (alias[0]) return alias[0].reportId;
    const byName = await this.dataSource.query(
      `SELECT id FROM reports_ref WHERE LOWER(TRIM(name)) = LOWER($1) LIMIT 1`,
      [reportName],
    );
    return byName[0]?.id ?? null;
  }

  @Post('ingest')
  async ingest(@Headers('x-log-secret') secret: string, @Body() body: LogEntry | LogEntry[]) {
    await this.checkSecret(secret);

    const entries = Array.isArray(body) ? body : [body];
    const valid = entries
      .filter(e => e?.reportName && e?.lastStatus)
      .map(e => ({ reportName: clean(e.reportName), lastStatus: clean(e.lastStatus) }));

    for (const e of valid) {
      const reportId = await this.matchReportId(e.reportName);
      await this.dataSource.query(
        `INSERT INTO dashboard_refresh_logs ("reportName", "lastStatus", "reportId") VALUES ($1, $2, $3)`,
        [e.reportName, e.lastStatus, reportId],
      );
    }
    return { inserted: valid.length };
  }

  // Read-back for the same secret used to write — lets the n8n workflow (or anyone debugging
  // it) confirm what actually landed, without an app login.
  @Get('recent')
  async recent(@Headers('x-log-secret') secret: string) {
    await this.checkSecret(secret);
    return this.dataSource.query(
      `SELECT * FROM dashboard_refresh_logs ORDER BY "checkedAt" DESC LIMIT 50`,
    );
  }

  @Delete()
  async deleteByIds(@Headers('x-log-secret') secret: string, @Body() body: { ids?: number[]; all?: boolean }) {
    await this.checkSecret(secret);
    if (body?.all) {
      const result = await this.dataSource.query(`DELETE FROM dashboard_refresh_logs`);
      return { deleted: result[1] ?? 0 };
    }
    if (!body?.ids?.length) return { deleted: 0 };
    await this.dataSource.query(`DELETE FROM dashboard_refresh_logs WHERE id = ANY($1)`, [body.ids]);
    return { deleted: body.ids.length };
  }

  // Manual override for SSRS catalog names that don't textually match the registry (e.g.
  // "Metrics (old name)" → "Marketing - Web analytics"). Maintenance-only, same secret as the rest
  // of this controller — not exposed in the app UI yet.
  @Post('aliases')
  async createAlias(
    @Headers('x-log-secret') secret: string,
    @Body() body: { sourceName: string; reportName: string },
  ) {
    await this.checkSecret(secret);
    const sourceName = clean(body?.sourceName);
    const reportName = (body?.reportName || '').trim();
    if (!sourceName || !reportName) throw new BadRequestException('sourceName и reportName обязательны');

    const matches = await this.dataSource.query(
      `SELECT id, name FROM reports_ref WHERE LOWER(TRIM(name)) = LOWER($1)`,
      [reportName],
    );
    if (!matches.length) throw new BadRequestException(`Отчёт "${reportName}" не найден в реестре`);
    const reportId = matches[0].id;

    await this.dataSource.query(`
      INSERT INTO dashboard_refresh_aliases ("sourceName", "reportId") VALUES ($1, $2)
      ON CONFLICT ("sourceName") DO UPDATE SET "reportId" = EXCLUDED."reportId"
    `, [sourceName, reportId]);

    // Backfill: existing log rows for this source name adopt the new link immediately.
    await this.dataSource.query(
      `UPDATE dashboard_refresh_logs SET "reportId" = $1 WHERE LOWER("reportName") = LOWER($2)`,
      [reportId, sourceName],
    );

    return { sourceName, reportId, reportName: matches[0].name };
  }

  // For SSRS names that are known-disabled dashboards, not a real refresh failure — hides the
  // source from "Не обновились сегодня" / "Хронические сбои" without needing a registry entry.
  @Post('exclude')
  async exclude(
    @Headers('x-log-secret') secret: string,
    @Body() body: { sourceName: string },
  ) {
    await this.checkSecret(secret);
    const sourceName = clean(body?.sourceName);
    if (!sourceName) throw new BadRequestException('sourceName обязателен');

    await this.dataSource.query(`
      INSERT INTO dashboard_refresh_aliases ("sourceName", "reportId", excluded) VALUES ($1, NULL, true)
      ON CONFLICT ("sourceName") DO UPDATE SET excluded = true, "reportId" = NULL
    `, [sourceName]);

    return { sourceName, excluded: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Query('from') from?: string, @Query('to') to?: string) {
    const conditions: string[] = [];
    const params: any[] = [];
    if (from) { params.push(from); conditions.push(`"checkedAt" >= $${params.length}`); }
    if (to) { params.push(to); conditions.push(`"checkedAt" <= $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.dataSource.query(
      `SELECT * FROM dashboard_refresh_logs ${where} ORDER BY "checkedAt" DESC LIMIT 2000`,
      params,
    );
  }

  // Lightweight version of the today/yesterday counts for the KPI tile shown on both the
  // executive dashboard and the requests page — avoids pulling the full analytics payload.
  @UseGuards(JwtAuthGuard)
  @Get('today-summary')
  async todaySummary() {
    // Must exclude known-disabled sources the same way the "analytics" endpoint below does —
    // otherwise this tile counts a source that the detail list (which does exclude it) no
    // longer shows, and the two disagree (e.g. tile says 3, list shows 2).
    const rows = await this.dataSource.query(`
      SELECT
        COUNT(DISTINCT d."reportName") FILTER (WHERE d."checkedAt"::date = CURRENT_DATE) AS today,
        COUNT(DISTINCT d."reportName") FILTER (WHERE d."checkedAt"::date = CURRENT_DATE - INTERVAL '1 day') AS yesterday
      FROM dashboard_refresh_logs d
      LEFT JOIN dashboard_refresh_aliases al ON LOWER(al."sourceName") = LOWER(d."reportName")
      WHERE NOT COALESCE(al.excluded, false)
    `);
    return { today: Number(rows[0]?.today || 0), yesterday: Number(rows[0]?.yesterday || 0) };
  }

  // Admin manually removes a dashboard from today's "not updated" list (e.g. it updated late,
  // after the n8n check ran). Deletes only today's log rows for that reportName.
  @UseGuards(JwtAuthGuard)
  @Delete('today')
  async dismissToday(@CurrentUser() user: any, @Query('reportName') reportName: string) {
    if (user.role !== 'admin') throw new ForbiddenException();
    if (!reportName) throw new BadRequestException('reportName обязателен');
    const result = await this.dataSource.query(
      `DELETE FROM dashboard_refresh_logs WHERE LOWER("reportName") = LOWER($1) AND "checkedAt"::date = CURRENT_DATE`,
      [reportName],
    );
    return { deleted: result[1] ?? 0 };
  }

  // Powers the "Обновление дашбордов" analytics tab: which dashboards failed within the
  // selected period (left list) and a daily failure count for the chart (right).
  @UseGuards(JwtAuthGuard)
  @Get('analytics')
  async analytics(@Query('from') from?: string, @Query('to') to?: string) {
    const conditions: string[] = [];
    const params: any[] = [];
    if (from) { params.push(from); conditions.push(`d."checkedAt" >= $${params.length}`); }
    if (to) { params.push(to); conditions.push(`d."checkedAt" <= $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [byReport, byDay, today, [{ totalReports }]] = await Promise.all([
      // Re-matched here (alias, then name) rather than relying solely on the reportId stored at
      // ingest time, so rows logged before an alias/registry entry existed still link up.
      // failureCount = distinct CALENDAR DAYS the report showed up as failed, not raw log
      // rows — n8n can log the same report more than once on the same day (re-runs, or a
      // report with several SSRS subscriptions each failing independently), which used to
      // inflate this into a same-day-duplicate count instead of "how many days it's been down".
      this.dataSource.query(`
        SELECT
          d."reportName",
          COALESCE(al."reportId", rr.id, d."reportId") AS "reportId",
          COUNT(DISTINCT d."checkedAt"::date)::int AS "failureCount",
          MAX(d."checkedAt") AS "lastFailureAt",
          (ARRAY_AGG(d."lastStatus" ORDER BY d."checkedAt" DESC))[1] AS "lastStatus"
        FROM dashboard_refresh_logs d
        LEFT JOIN dashboard_refresh_aliases al ON LOWER(al."sourceName") = LOWER(d."reportName")
        LEFT JOIN reports_ref rr ON LOWER(TRIM(rr.name)) = LOWER(d."reportName")
        ${where}
        ${where ? 'AND' : 'WHERE'} NOT COALESCE(al.excluded, false)
        GROUP BY d."reportName", COALESCE(al."reportId", rr.id, d."reportId")
        ORDER BY "failureCount" DESC
      `, params),
      // count = distinct dashboards that failed that day, not raw log rows (same duplication
      // reason as above — otherwise a day with 7 failing dashboards but a few double-logged
      // could show as 17). Excludes known-disabled dashboards, same as the two lists above.
      this.dataSource.query(`
        SELECT TO_CHAR(d."checkedAt", 'YYYY-MM-DD') AS day, COUNT(DISTINCT d."reportName")::int AS count
        FROM dashboard_refresh_logs d
        LEFT JOIN dashboard_refresh_aliases al ON LOWER(al."sourceName") = LOWER(d."reportName")
        ${where}
        ${where ? 'AND' : 'WHERE'} NOT COALESCE(al.excluded, false)
        GROUP BY day
        ORDER BY day ASC
      `, params),
      // Always literally today, regardless of the from/to range picker — this is "what's
      // broken right now", not a period stat.
      this.dataSource.query(`
        SELECT
          d."reportName",
          COALESCE(al."reportId", rr.id, d."reportId") AS "reportId",
          (ARRAY_AGG(d."lastStatus" ORDER BY d."checkedAt" DESC))[1] AS "lastStatus",
          MAX(d."checkedAt") AS "lastFailureAt"
        FROM dashboard_refresh_logs d
        LEFT JOIN dashboard_refresh_aliases al ON LOWER(al."sourceName") = LOWER(d."reportName")
        LEFT JOIN reports_ref rr ON LOWER(TRIM(rr.name)) = LOWER(d."reportName")
        WHERE d."checkedAt"::date = CURRENT_DATE AND NOT COALESCE(al.excluded, false)
        GROUP BY d."reportName", COALESCE(al."reportId", rr.id, d."reportId")
        ORDER BY d."reportName"
      `),
      // Denominator for "X дашбордов из Y в реестре" context next to the daily average.
      this.dataSource.query(
        `SELECT COUNT(*)::int AS "totalReports" FROM reports_ref WHERE status = 'active'`,
      ),
    ]);
    return { byReport, byDay, today, totalReports };
  }
}
