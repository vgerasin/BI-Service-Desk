import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { BiRequest, RequestStatus } from '../requests/request.entity';
import { EmployeesService } from '../employees/employees.service';
import * as ExcelJS from 'exceljs';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(BiRequest) private requestsRepo: Repository<BiRequest>,
    private dataSource: DataSource,
    private employeesService: EmployeesService,
  ) {}

  async getDashboard() {
    const [
      statusCounts,
      typeStatusCounts,
      totalRequests,
      doneThisMonth,
      overdue,
      assigneeLoad,
      avgRows,
      ratingRows,
      recentRequests,
      refreshRows,
      dayCountRows,
      yesterdayStateRows,
    ] = await Promise.all([
      this.requestsRepo
        .createQueryBuilder('r')
        .select('r.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('r.status')
        .getRawMany(),

      // Feeds the "по видам работ" breakdown on the executive dashboard — a request's status
      // means something different per type (a bug skips the "Проектирование" stage a new
      // dashboard goes through), so one flat status list conflates unrelated pipelines. Grouping
      // is done client-side (see DashboardPage.tsx) to keep this a plain cross-tab.
      this.requestsRepo
        .createQueryBuilder('r')
        .select('r.type', 'type')
        .addSelect('r.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('r.type')
        .addGroupBy('r.status')
        .getRawMany(),

      this.requestsRepo.count(),

      this.requestsRepo
        .createQueryBuilder('r')
        .where('r.status = :s', { s: RequestStatus.DONE })
        .andWhere("DATE_TRUNC('month', r.closedAt) = DATE_TRUNC('month', NOW())")
        .getCount(),

      this.requestsRepo
        .createQueryBuilder('r')
        .where('r.plannedDate < NOW()')
        .andWhere('r.status NOT IN (:...closed)', { closed: [RequestStatus.DONE, RequestStatus.REJECTED, RequestStatus.CANCELLED] })
        .getCount(),

      // Real task assignment goes through requests.assigneeId -> users (see request.entity.ts —
      // contractorId is a separate, optional field used for Act/billing grouping, not the
      // primary "who's doing this" link). Querying only `contractors` here used to show 0 active
      // requests for everyone, since almost nothing is actually assigned via contractorId — hours
      // still showed up for whoever logged time under their contractor login, which is what made
      // the bug visible (0 заяв. next to non-zero ч.). Hours are unioned from both userId- and
      // contractor-linked (matched by email, same convention as TimeEntriesService.findAll)
      // time entries, so a person's hours count regardless of which login they logged them under.
      // A contractor with no matching users row (no app login at all) still gets its own row via
      // the second branch, so nobody silently drops off the list.
      this.dataSource.query(`
        WITH staff AS (
          SELECT u.id, u."fullName",
                 COUNT(DISTINCT r.id)::int AS "requestCount",
                 COALESCE(SUM(te.hours), 0)::float AS "totalHours"
          FROM users u
          LEFT JOIN requests r
            ON r."assigneeId" = u.id
            AND r.status NOT IN ('done','rejected','cancelled')
          LEFT JOIN time_entries te
            ON (te."userId" = u.id OR te."contractorId" IN (SELECT c.id FROM contractors c WHERE c.email = u.email))
            AND te.date >= DATE_TRUNC('month', NOW())
          WHERE u."isActive" = true AND u.role = 'executor'
          GROUP BY u.id, u."fullName"
        ),
        unlinked_contractors AS (
          SELECT c.id, c.name AS "fullName",
                 COUNT(DISTINCT r.id)::int AS "requestCount",
                 COALESCE(SUM(te.hours), 0)::float AS "totalHours"
          FROM contractors c
          LEFT JOIN requests r
            ON r."contractorId" = c.id
            AND r.status NOT IN ('done','rejected','cancelled')
          LEFT JOIN time_entries te
            ON te."contractorId" = c.id
            AND te.date >= DATE_TRUNC('month', NOW())
          WHERE c."isActive" = true
            AND NOT EXISTS (SELECT 1 FROM users u2 WHERE u2.email = c.email)
          GROUP BY c.id, c.name
        )
        SELECT * FROM staff
        UNION ALL
        SELECT * FROM unlinked_contractors
        ORDER BY "requestCount" DESC
        LIMIT 10
      `),

      // Only development/improvement — bugfixes and consultations skew this much shorter and
      // aren't what "среднее время разработки/доработки" is meant to convey.
      this.dataSource.query(`
        SELECT ROUND(AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 86400)::numeric, 1) as avg_days
        FROM requests
        WHERE status = 'done' AND "closedAt" IS NOT NULL
          AND type IN ('development', 'improvement')
          AND "closedAt" >= NOW() - INTERVAL '90 days'
      `),

      this.dataSource.query(`
        SELECT ROUND(AVG("avgScore")::numeric, 1) as avg_rating, COUNT(*) as rated_count
        FROM request_ratings WHERE "submittedAt" IS NOT NULL
      `),

      // Active requests before closed ones (see RequestsService.findAll for the same rule),
      // newest-first within each group — a "recent" widget dominated by already-closed requests
      // isn't useful on an executive overview. Sorted in JS (not a raw CASE orderBy) because
      // that breaks TypeORM's getMany() once leftJoinAndSelect + take() are both in play.
      this.requestsRepo.createQueryBuilder('r')
        .leftJoinAndSelect('r.customer', 'customer')
        .leftJoinAndSelect('r.createdBy', 'createdBy')
        .leftJoinAndSelect('r.contractor', 'contractor')
        .leftJoinAndSelect('r.report', 'report')
        .orderBy('r.createdAt', 'DESC')
        .take(50)
        .getMany()
        .then((rows) => {
          const closed = ['done', 'rejected', 'cancelled'];
          rows.sort((a, b) => {
            const aClosed = closed.includes(a.status) ? 1 : 0;
            const bClosed = closed.includes(b.status) ? 1 : 0;
            if (aClosed !== bClosed) return aClosed - bClosed;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          });
          return rows.slice(0, 5);
        }),

      this.dataSource.query(`
        SELECT
          COUNT(DISTINCT "reportName") FILTER (WHERE "checkedAt"::date = CURRENT_DATE) AS today,
          COUNT(DISTINCT "reportName") FILTER (WHERE "checkedAt"::date = CURRENT_DATE - INTERVAL '1 day') AS yesterday
        FROM dashboard_refresh_logs
      `),

      // Created/closed today vs yesterday — straightforward day-over-day event counts.
      this.dataSource.query(`
        SELECT
          COUNT(*) FILTER (WHERE "createdAt"::date = CURRENT_DATE) AS "createdToday",
          COUNT(*) FILTER (WHERE "createdAt"::date = CURRENT_DATE - INTERVAL '1 day') AS "createdYesterday",
          COUNT(*) FILTER (WHERE status = 'done' AND "closedAt"::date = CURRENT_DATE) AS "closedToday",
          COUNT(*) FILTER (WHERE status = 'done' AND "closedAt"::date = CURRENT_DATE - INTERVAL '1 day') AS "closedYesterday"
        FROM requests
      `),

      // "В работе" / "Просрочено" as of yesterday (start of today) — reconstructed from
      // status_changed history since we don't keep daily snapshots. For each request that
      // already existed by then, its status "yesterday" is whatever the last status_changed
      // event before today's cutoff set it to, or 'new' if it never changed before that.
      this.dataSource.query(`
        WITH status_at_cutoff AS (
          SELECT r.id, r."plannedDate",
            COALESCE(
              (SELECT al.meta->>'to' FROM activity_logs al
               WHERE al."entityType" = 'request' AND al."entityId" = r.id AND al.event = 'status_changed'
                 AND al."createdAt" < CURRENT_DATE
               ORDER BY al."createdAt" DESC LIMIT 1),
              'new'
            ) AS status_yesterday
          FROM requests r
          WHERE r."createdAt" < CURRENT_DATE
        )
        SELECT
          COUNT(*) FILTER (WHERE status_yesterday = 'in_progress') AS "inProgressYesterday",
          COUNT(*) FILTER (
            WHERE status_yesterday NOT IN ('done', 'rejected', 'cancelled')
              AND "plannedDate" < CURRENT_DATE
          ) AS "overdueYesterday"
        FROM status_at_cutoff
      `),
    ]);

    return {
      statusCounts,
      typeStatusCounts,
      overdue,
      totalRequests,
      doneThisMonth,
      assigneeLoad,
      avgDays: avgRows[0]?.avg_days ? Number(avgRows[0].avg_days) : null,
      avgRating: ratingRows[0]?.avg_rating ? Number(ratingRows[0].avg_rating) : null,
      ratedCount: Number(ratingRows[0]?.rated_count || 0),
      recentRequests,
      dashboardRefreshFailuresToday: Number(refreshRows[0]?.today || 0),
      dashboardRefreshFailuresYesterday: Number(refreshRows[0]?.yesterday || 0),
      totalRequestsYesterday: totalRequests - Number(dayCountRows[0]?.createdToday || 0),
      createdToday: Number(dayCountRows[0]?.createdToday || 0),
      createdYesterday: Number(dayCountRows[0]?.createdYesterday || 0),
      doneThisMonthYesterday: doneThisMonth - Number(dayCountRows[0]?.closedToday || 0),
      closedToday: Number(dayCountRows[0]?.closedToday || 0),
      closedYesterday: Number(dayCountRows[0]?.closedYesterday || 0),
      inProgressYesterday: Number(yesterdayStateRows[0]?.inProgressYesterday || 0),
      overdueYesterday: Number(yesterdayStateRows[0]?.overdueYesterday || 0),
    };
  }

  // ── Executive Dashboard ──────────────────────────────────────────────────
  async getExecutiveDashboard() {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thisMonthStr = thisMonthStart.toISOString().split('T')[0];

    const [
      statusRows,
      doneThisMonth,
      doneLastMonth,
      overdue,
      bugMttr,
      ratingRow,
      monthlyTrend,
      monthlyCost,
      topDashboards,
      teamLoad,
    ] = await Promise.all([
      this.dataSource.query(`
        SELECT status, COUNT(*) as count FROM requests
        WHERE status NOT IN ('done','rejected','cancelled')
        GROUP BY status ORDER BY count DESC
      `),
      this.dataSource.query(`
        SELECT COUNT(*) as count FROM requests
        WHERE status = 'done' AND "closedAt" >= $1
      `, [thisMonthStart.toISOString()]),
      this.dataSource.query(`
        SELECT COUNT(*) as count FROM requests
        WHERE status = 'done' AND "closedAt" >= $1 AND "closedAt" < $2
      `, [lastMonthStart.toISOString(), thisMonthStart.toISOString()]),
      this.dataSource.query(`
        SELECT COUNT(*) as count FROM requests
        WHERE "plannedDate" < NOW() AND status NOT IN ('done','rejected','cancelled')
      `),
      this.dataSource.query(`
        SELECT ROUND(AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 86400)::numeric, 1) as avg_days
        FROM requests
        WHERE type = 'bugfix' AND status = 'done' AND "closedAt" IS NOT NULL
          AND "closedAt" >= NOW() - INTERVAL '30 days'
      `),
      this.dataSource.query(`
        SELECT ROUND(AVG("avgScore")::numeric, 2) as avg_rating, COUNT(*) as rated_count
        FROM request_ratings WHERE "submittedAt" IS NOT NULL
      `),
      // 6-month trend via correlated subqueries (avoids cross-join double-count)
      this.dataSource.query(`
        SELECT
          TO_CHAR(m.month, 'YYYY-MM') as month,
          (SELECT COUNT(*) FROM requests
           WHERE DATE_TRUNC('month', "createdAt") = m.month) as created,
          (SELECT COUNT(*) FROM requests
           WHERE status = 'done' AND DATE_TRUNC('month', "closedAt") = m.month) as done
        FROM generate_series(
          DATE_TRUNC('month', NOW()) - INTERVAL '5 months',
          DATE_TRUNC('month', NOW()), '1 month'
        ) m(month)
        ORDER BY m.month
      `),
      this.dataSource.query(`
        SELECT COALESCE(SUM(te.hours * COALESCE(rh.rate, 0)), 0) as cost
        FROM time_entries te
        LEFT JOIN LATERAL (
          SELECT rate FROM rate_history rh2
          WHERE (rh2."userId" = te."userId" OR rh2."contractorId" = te."contractorId")
            AND rh2."dateFrom" <= te.date
            AND (rh2."dateTo" IS NULL OR rh2."dateTo" >= te.date)
          ORDER BY rh2."dateFrom" DESC LIMIT 1
        ) rh ON true
        WHERE te.date >= $1
      `, [thisMonthStr]),
      this.dataSource.query(`
        SELECT rr.name as "reportName",
          COALESCE(SUM(te.hours * COALESCE(rh.rate, 0)), 0) as "totalCost",
          COUNT(DISTINCT req.id) as "requestCount"
        FROM reports_ref rr
        JOIN requests req ON req."reportId" = rr.id
        LEFT JOIN time_entries te ON te."requestId" = req.id
        LEFT JOIN LATERAL (
          SELECT rate FROM rate_history rh2
          WHERE (rh2."userId" = te."userId" OR rh2."contractorId" = te."contractorId")
            AND rh2."dateFrom" <= te.date AND (rh2."dateTo" IS NULL OR rh2."dateTo" >= te.date)
          ORDER BY rh2."dateFrom" DESC LIMIT 1
        ) rh ON true
        GROUP BY rr.id, rr.name
        ORDER BY "totalCost" DESC LIMIT 5
      `),
      this.dataSource.query(`
        SELECT name, SUM(cnt) as active_count FROM (
          SELECT COALESCE(u."fullName", 'Без назначения') as name, COUNT(DISTINCT r.id) as cnt
          FROM requests r
          JOIN users u ON u.id = r."assigneeId"
          WHERE r.status NOT IN ('done','rejected','cancelled')
          GROUP BY u."fullName"
          UNION ALL
          SELECT con.name, COUNT(DISTINCT r.id) as cnt
          FROM requests r
          JOIN contractors con ON con.id = r."contractorId"
          WHERE r.status NOT IN ('done','rejected','cancelled')
            AND NOT EXISTS (SELECT 1 FROM users u WHERE u.email = con.email AND u."isActive" = true)
          GROUP BY con.name
        ) t
        GROUP BY name HAVING SUM(cnt) > 0
        ORDER BY active_count DESC LIMIT 8
      `),
    ]);

    return {
      activeRequests: statusRows.reduce((s: number, r: any) => s + Number(r.count), 0),
      doneThisMonth: Number(doneThisMonth[0]?.count || 0),
      doneLastMonth: Number(doneLastMonth[0]?.count || 0),
      overdue: Number(overdue[0]?.count || 0),
      avgBugMttr: bugMttr[0]?.avg_days ? Number(bugMttr[0].avg_days) : null,
      avgRating: ratingRow[0]?.avg_rating ? Number(ratingRow[0].avg_rating) : null,
      ratedCount: Number(ratingRow[0]?.rated_count || 0),
      monthlyCost: Number(monthlyCost[0]?.cost || 0),
      monthlyTrend: monthlyTrend.map((r: any) => ({
        month: r.month,
        created: Number(r.created),
        done: Number(r.done),
      })),
      statusBreakdown: statusRows.map((r: any) => ({
        status: r.status,
        count: Number(r.count),
      })),
      topDashboards: topDashboards.map((r: any) => ({
        reportName: r.reportName,
        totalCost: Number(r.totalCost),
        requestCount: Number(r.requestCount),
      })),
      teamLoad: teamLoad.map((r: any) => ({
        name: r.name,
        activeCount: Number(r.active_count),
      })),
    };
  }

  // ── Bug metrics ─────────────────────────────────────────────────────────
  async getBugMetrics(filters: { dateFrom?: string; dateTo?: string }) {
    const params: string[] = [];
    const conds: string[] = [];
    if (filters.dateFrom) { params.push(filters.dateFrom); conds.push(`AND "createdAt"::date >= $${params.length}`); }
    if (filters.dateTo) { params.push(filters.dateTo); conds.push(`AND "createdAt"::date <= $${params.length}`); }
    const c = conds.join(' ');

    const [summary, byPriority, trend, distribution] = await Promise.all([
      this.dataSource.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'done') as resolved,
          COUNT(*) FILTER (WHERE status NOT IN ('done','rejected','cancelled')) as open,
          ROUND(AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 86400)
            FILTER (WHERE status = 'done' AND "closedAt" IS NOT NULL)::numeric, 1) as avg_days,
          ROUND(AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 86400)
            FILTER (WHERE priority = 'critical' AND status = 'done' AND "closedAt" IS NOT NULL)::numeric, 1) as critical_days,
          COUNT(*) FILTER (WHERE status = 'done' AND "plannedDate" IS NOT NULL AND "closedAt" <= "plannedDate") as in_sla,
          COUNT(*) FILTER (WHERE status = 'done' AND "plannedDate" IS NOT NULL) as with_plan
        FROM requests
        WHERE type = 'bugfix' ${c}
      `, params),

      this.dataSource.query(`
        SELECT
          COALESCE(priority, 'medium') as priority,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'done') as resolved,
          ROUND(AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 86400)
            FILTER (WHERE status = 'done' AND "closedAt" IS NOT NULL)::numeric, 1) as avg_days
        FROM requests
        WHERE type = 'bugfix' ${c}
        GROUP BY priority ORDER BY total DESC
      `, params),

      this.dataSource.query(`
        SELECT
          TO_CHAR(m.month, 'YYYY-MM') as month,
          (SELECT COUNT(*) FROM requests
           WHERE type = 'bugfix' AND DATE_TRUNC('month', "createdAt") = m.month) as reported,
          (SELECT COUNT(*) FROM requests
           WHERE type = 'bugfix' AND status = 'done' AND DATE_TRUNC('month', "closedAt") = m.month) as resolved
        FROM generate_series(
          DATE_TRUNC('month', NOW()) - INTERVAL '5 months',
          DATE_TRUNC('month', NOW()), '1 month'
        ) m(month)
        ORDER BY m.month
      `),

      this.dataSource.query(`
        SELECT
          CASE
            WHEN EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 86400 <= 1 THEN '≤ 1 день'
            WHEN EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 86400 <= 3 THEN '1–3 дня'
            WHEN EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 86400 <= 7 THEN '3–7 дней'
            ELSE '7+ дней'
          END as bucket,
          COUNT(*) as count
        FROM requests
        WHERE type = 'bugfix' AND status = 'done' AND "closedAt" IS NOT NULL ${c}
        GROUP BY bucket
        ORDER BY MIN(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")))
      `, params),
    ]);

    const s = summary[0];
    const withPlan = Number(s.with_plan || 0);
    const inSla = Number(s.in_sla || 0);

    return {
      total: Number(s.total || 0),
      resolved: Number(s.resolved || 0),
      open: Number(s.open || 0),
      avgResolutionDays: s.avg_days ? Number(s.avg_days) : null,
      avgCriticalDays: s.critical_days ? Number(s.critical_days) : null,
      slaCompliance: withPlan > 0 ? Math.round(inSla / withPlan * 100) : null,
      byPriority: byPriority.map((r: any) => ({
        priority: r.priority,
        total: Number(r.total),
        resolved: Number(r.resolved),
        avgDays: r.avg_days ? Number(r.avg_days) : null,
      })),
      monthlyTrend: trend.map((r: any) => ({
        month: r.month,
        reported: Number(r.reported),
        resolved: Number(r.resolved),
      })),
      resolutionDistribution: distribution.map((r: any) => ({
        bucket: r.bucket,
        count: Number(r.count),
      })),
    };
  }

  // ── Rating metrics ──────────────────────────────────────────────────────
  async getRatingMetrics(filters: { dateFrom?: string; dateTo?: string }) {
    const params: string[] = [];
    const conds: string[] = [];
    if (filters.dateFrom) { params.push(filters.dateFrom); conds.push(`AND rr."submittedAt"::date >= $${params.length}`); }
    if (filters.dateTo) { params.push(filters.dateTo); conds.push(`AND rr."submittedAt"::date <= $${params.length}`); }
    const c = conds.join(' ');

    // Same dateFrom/dateTo values, same $1/$2 positions (built in the same order as `conds`
    // above) — just against the request's own closedAt instead of the rating's submittedAt, so
    // "X оценено" is measured against "Y closed in this window", not an all-time eligible count.
    // Without this, picking a narrow period made "оценено X / Y" read as if only X of Y requests
    // closed *ever* got rated, when Y was actually every done request regardless of period.
    const eligibleConds: string[] = [];
    if (filters.dateFrom) eligibleConds.push(`AND r."closedAt"::date >= $1`);
    if (filters.dateTo) eligibleConds.push(`AND r."closedAt"::date <= $${filters.dateFrom ? 2 : 1}`);
    const eligibleC = eligibleConds.join(' ');

    const [summary, byType, byCustomerRaw, trend, distribution, unratedRaw] = await Promise.all([
      // "AND EXISTS ... requests" guards against a request_ratings row whose requestId points at
      // nothing (the underlying request no longer exists, e.g. deleted test data) — found via a
      // real mismatch this caused: this query and `distribution` below don't join requests at
      // all, so they silently counted such a row while byType/byCustomer/ratingsDetail (which DO
      // join requests) dropped it, making the top "Оценено X/Y" KPI disagree with every table
      // under it by exactly one.
      this.dataSource.query(`
        SELECT
          ROUND(AVG(rr."avgScore")::numeric, 2) as avg_score,
          COUNT(rr.id) as rated_count,
          (SELECT COUNT(*) FROM requests r WHERE r.status = 'done' ${eligibleC}) as total_eligible
        FROM request_ratings rr
        WHERE rr."submittedAt" IS NOT NULL ${c}
          AND EXISTS (SELECT 1 FROM requests req WHERE req.id = rr."requestId")
      `, params),

      this.dataSource.query(`
        SELECT req.type,
          ROUND(AVG(rr."avgScore")::numeric, 2) as avg_score,
          COUNT(rr.id) as count
        FROM request_ratings rr
        JOIN requests req ON req.id = rr."requestId"
        WHERE rr."submittedAt" IS NOT NULL ${c}
        GROUP BY req.type ORDER BY count DESC
      `, params),

      // Row-level (not pre-grouped) — most requesters are internal staff (createdBy, or "заявитель
      // другой" via onBehalfOfEmail), not portal Customer records, so customers.department is
      // sparse. The real department (and the rater's name, for the detail list below) comes from
      // the HR employee directory by email, resolved below after this query returns (that
      // directory lives on a separate Postgres server — see EmployeesService — so it can't be
      // joined here in one statement). customers.department/creator's own fullName stay as
      // fallbacks for people with no matching HR record.
      this.dataSource.query(`
        SELECT
          rr."avgScore" as avg_score,
          rr."submittedAt" as submitted_at,
          req.id as request_id,
          req.number as request_number,
          req.name as request_name,
          rep.name as dashboard_name,
          c.department as customer_department,
          COALESCE(req."onBehalfOfName", u."fullName") as fallback_name,
          COALESCE(req."onBehalfOfEmail", u.email) as requester_email
        FROM request_ratings rr
        JOIN requests req ON req.id = rr."requestId"
        LEFT JOIN reports_ref rep ON rep.id = req."reportId"
        LEFT JOIN customers c ON c.id = req."customerId"
        LEFT JOIN users u ON u.id = req."createdById"
        WHERE rr."submittedAt" IS NOT NULL ${c}
        ORDER BY rr."submittedAt" DESC
      `, params),

      this.dataSource.query(`
        SELECT
          TO_CHAR(m.month, 'YYYY-MM') as month,
          (SELECT ROUND(AVG("avgScore")::numeric, 2) FROM request_ratings rr2
           WHERE rr2."submittedAt" IS NOT NULL AND DATE_TRUNC('month', rr2."submittedAt") = m.month
             AND EXISTS (SELECT 1 FROM requests req WHERE req.id = rr2."requestId")) as avg_score,
          (SELECT COUNT(*) FROM request_ratings rr2
           WHERE rr2."submittedAt" IS NOT NULL AND DATE_TRUNC('month', rr2."submittedAt") = m.month
             AND EXISTS (SELECT 1 FROM requests req WHERE req.id = rr2."requestId")) as count
        FROM generate_series(
          DATE_TRUNC('month', NOW()) - INTERVAL '5 months',
          DATE_TRUNC('month', NOW()), '1 month'
        ) m(month)
        ORDER BY m.month
      `),

      this.dataSource.query(`
        SELECT ROUND(rr."avgScore")::int as score, COUNT(*) as count
        FROM request_ratings rr
        WHERE rr."submittedAt" IS NOT NULL ${c}
          AND EXISTS (SELECT 1 FROM requests req WHERE req.id = rr."requestId")
        GROUP BY ROUND(rr."avgScore")::int ORDER BY score
      `, params),

      // Eligible-but-not-rated requests — the "оценено X/Y" KPI already counts these in the Y,
      // but until now there was no way to actually see *which* Y-X requests are still waiting on
      // the customer. Same eligibility window as total_eligible above (closedAt, not
      // submittedAt — a request can be "eligible" for a period with no rating at all yet), reuses
      // the same $1/$2 param positions as eligibleC — which is why requests is aliased "r" here,
      // matching the alias eligibleC was written against (the total_eligible subquery above), not
      // the "req" used elsewhere in this file.
      this.dataSource.query(`
        SELECT
          r.id as request_id,
          r.number as request_number,
          r.name as request_name,
          rep.name as dashboard_name,
          r."closedAt" as closed_at,
          c.department as customer_department,
          COALESCE(r."onBehalfOfName", u."fullName") as fallback_name,
          COALESCE(r."onBehalfOfEmail", u.email) as requester_email
        FROM requests r
        LEFT JOIN reports_ref rep ON rep.id = r."reportId"
        LEFT JOIN customers c ON c.id = r."customerId"
        LEFT JOIN users u ON u.id = r."createdById"
        WHERE r.status = 'done' ${eligibleC}
          AND NOT EXISTS (
            SELECT 1 FROM request_ratings rr WHERE rr."requestId" = r.id AND rr."submittedAt" IS NOT NULL
          )
        ORDER BY r."closedAt" DESC
      `, params),
    ]);

    const s = summary[0];
    const ratedCount = Number(s.rated_count || 0);
    const totalEligible = Number(s.total_eligible || 0);

    // HR directory lives on a separate server (see EmployeesService) — a hiccup there shouldn't
    // 500 the whole ratings tab, just fall back to customers.department/"Не указан" for everyone.
    let hrByEmail = new Map<string, { department: string | null; fullName: string }>();
    try {
      const emails = [...byCustomerRaw, ...unratedRaw].map((r: any) => r.requester_email).filter(Boolean);
      hrByEmail = await this.employeesService.findByEmails(emails);
    } catch { /* HR DB unreachable — degrade gracefully below */ }

    const byCustomerGrouped = new Map<string, { sum: number; count: number }>();
    const ratingsDetail: any[] = [];
    for (const r of byCustomerRaw as any[]) {
      const hr = r.requester_email ? hrByEmail.get(String(r.requester_email).toLowerCase()) : undefined;
      const department = hr?.department || r.customer_department || 'Не указан';
      const raterName = hr?.fullName || r.fallback_name || '—';

      const g = byCustomerGrouped.get(department) || { sum: 0, count: 0 };
      g.sum += Number(r.avg_score);
      g.count += 1;
      byCustomerGrouped.set(department, g);

      ratingsDetail.push({
        requestId: r.request_id,
        requestNumber: r.request_number,
        requestName: r.request_name,
        dashboardName: r.dashboard_name,
        raterName,
        department,
        avgScore: Number(r.avg_score),
        submittedAt: r.submitted_at,
      });
    }
    const byCustomer = [...byCustomerGrouped.entries()]
      .map(([department, g]) => ({
        department,
        avgScore: Math.round((g.sum / g.count) * 100) / 100,
        count: g.count,
      }))
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, 10);

    const unratedDetail = (unratedRaw as any[]).map((r) => {
      const hr = r.requester_email ? hrByEmail.get(String(r.requester_email).toLowerCase()) : undefined;
      return {
        requestId: r.request_id,
        requestNumber: r.request_number,
        requestName: r.request_name,
        dashboardName: r.dashboard_name,
        raterName: hr?.fullName || r.fallback_name || '—',
        department: hr?.department || r.customer_department || 'Не указан',
        closedAt: r.closed_at,
      };
    });

    return {
      avgScore: s.avg_score ? Number(s.avg_score) : null,
      ratedCount,
      totalEligible,
      responseRate: totalEligible > 0 ? Math.round(ratedCount / totalEligible * 100) : 0,
      byType: byType.map((r: any) => ({
        type: r.type,
        avgScore: Number(r.avg_score),
        count: Number(r.count),
      })),
      byCustomer,
      ratingsDetail,
      unratedDetail,
      monthlyTrend: trend.map((r: any) => ({
        month: r.month,
        avgScore: r.avg_score ? Number(r.avg_score) : null,
        count: Number(r.count),
      })),
      distribution: distribution.map((r: any) => ({
        score: Number(r.score),
        count: Number(r.count),
      })),
    };
  }

  // ── Cost report ─────────────────────────────────────────────────────────
  async getCostReport(filters: {
    dateFrom?: string; dateTo?: string; requestId?: number;
    reportId?: number; customerId?: number; executorUserIds?: number[];
  }) {
    const params: (string | number | number[])[] = [];
    const conditions: string[] = [];

    if (filters.dateFrom) { params.push(filters.dateFrom); conditions.push(`AND te.date >= $${params.length}`); }
    if (filters.dateTo) { params.push(filters.dateTo); conditions.push(`AND te.date <= $${params.length}`); }
    if (filters.requestId) { params.push(filters.requestId); conditions.push(`AND te."requestId" = $${params.length}`); }
    if (filters.reportId) { params.push(filters.reportId); conditions.push(`AND r."reportId" = $${params.length}`); }
    if (filters.customerId) { params.push(filters.customerId); conditions.push(`AND r."customerId" = $${params.length}`); }
    if (filters.executorUserIds?.length) { params.push(filters.executorUserIds); conditions.push(`AND te."userId" = ANY($${params.length})`); }

    const rows = await this.dataSource.query(`
      SELECT
        te.id as "timeEntryId",
        r.id as "requestId",
        r.number as "requestNumber",
        r.name as "requestName",
        rr.name as "reportName",
        c.department as "customerDept",
        COALESCE(u."fullName", con.name) as "executorName",
        CASE WHEN te."userId" IS NOT NULL THEN 'Штат' ELSE 'Подрядчик' END as "executorType",
        te.date,
        te.hours,
        te."workKind",
        COALESCE(rh.rate, 0) as rate,
        COALESCE(rh.currency, 'RUB') as currency,
        te.hours * COALESCE(rh.rate, 0) as cost
      FROM time_entries te
      JOIN requests r ON r.id = te."requestId"
      LEFT JOIN reports_ref rr ON rr.id = r."reportId"
      LEFT JOIN customers c ON c.id = r."customerId"
      LEFT JOIN users u ON u.id = te."userId"
      LEFT JOIN contractors con ON con.id = te."contractorId"
      LEFT JOIN LATERAL (
        SELECT rate, currency FROM rate_history rh2
        WHERE (rh2."userId" = te."userId" OR rh2."contractorId" = te."contractorId")
          AND rh2."dateFrom" <= te.date
          AND (rh2."dateTo" IS NULL OR rh2."dateTo" >= te.date)
        ORDER BY rh2."dateFrom" DESC
        LIMIT 1
      ) rh ON true
      WHERE 1=1
        ${conditions.join('\n        ')}
      ORDER BY te.date DESC
    `, params);

    const totalCost = rows.reduce((s: number, r: any) => s + Number(r.cost), 0);
    const totalHours = rows.reduce((s: number, r: any) => s + Number(r.hours), 0);

    return { rows, totalCost, totalHours };
  }

  async getDashboardCostReport(filters: { dateFrom?: string; dateTo?: string; executorUserIds?: number[] }) {
    const params: (string | number | number[])[] = [];
    const conditions: string[] = [];

    if (filters.dateFrom) { params.push(filters.dateFrom); conditions.push(`AND te.date >= $${params.length}`); }
    if (filters.dateTo) { params.push(filters.dateTo); conditions.push(`AND te.date <= $${params.length}`); }
    if (filters.executorUserIds?.length) { params.push(filters.executorUserIds); conditions.push(`AND te."userId" = ANY($${params.length})`); }

    const rows = await this.dataSource.query(`
      SELECT
        r.id AS "requestId",
        r.type,
        r."reportId",
        COALESCE(rr.name, 'Без отчёта') AS "reportName",
        COALESCE(SUM(te.hours * COALESCE(rh.rate, 0)), 0) AS cost,
        COALESCE(SUM(te.hours), 0) AS hours
      FROM requests r
      LEFT JOIN reports_ref rr ON rr.id = r."reportId"
      LEFT JOIN time_entries te ON te."requestId" = r.id
        ${conditions.join('\n        ')}
      LEFT JOIN LATERAL (
        SELECT rate FROM rate_history rh2
        WHERE (rh2."userId" = te."userId" OR rh2."contractorId" = te."contractorId")
          AND rh2."dateFrom" <= te.date
          AND (rh2."dateTo" IS NULL OR rh2."dateTo" >= te.date)
        ORDER BY rh2."dateFrom" DESC
        LIMIT 1
      ) rh ON true
      GROUP BY r.id, r.type, r."reportId", rr.name
    `, params);

    const devCosts = rows
      .filter((r: any) => r.type === 'development' && Number(r.cost) > 0)
      .map((r: any) => Number(r.cost));
    const fixCosts = rows
      .filter((r: any) => (r.type === 'improvement' || r.type === 'bugfix') && Number(r.cost) > 0)
      .map((r: any) => Number(r.cost));
    const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

    const byDashboardMap = new Map<number, any>();
    for (const r of rows) {
      if (r.reportId == null) continue;
      if (!byDashboardMap.has(r.reportId)) {
        byDashboardMap.set(r.reportId, {
          reportId: r.reportId, reportName: r.reportName,
          requestCount: 0, hours: 0, totalCost: 0, developmentCost: 0, fixCost: 0,
        });
      }
      const entry = byDashboardMap.get(r.reportId);
      entry.requestCount += 1;
      entry.hours += Number(r.hours);
      entry.totalCost += Number(r.cost);
      if (r.type === 'development') entry.developmentCost += Number(r.cost);
      if (r.type === 'improvement' || r.type === 'bugfix') entry.fixCost += Number(r.cost);
    }
    const byDashboard = Array.from(byDashboardMap.values()).sort((a, b) => b.totalCost - a.totalCost);

    return {
      avgDevelopmentCost: avg(devCosts),
      avgFixCost: avg(fixCosts),
      devCount: devCosts.length,
      fixCount: fixCosts.length,
      byDashboard,
    };
  }

  async exportCostToExcel(filters: any): Promise<Buffer> {
    const { rows } = await this.getCostReport(filters);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Себестоимость');

    ws.columns = [
      { header: '№ Заявки', key: 'requestNumber', width: 15 },
      { header: 'Наименование заявки', key: 'requestName', width: 40 },
      { header: 'Отчёт', key: 'reportName', width: 25 },
      { header: 'Заказчик', key: 'customerDept', width: 25 },
      { header: 'Исполнитель', key: 'executorName', width: 25 },
      { header: 'Тип', key: 'executorType', width: 12 },
      { header: 'Дата', key: 'date', width: 12 },
      { header: 'Вид работ', key: 'workKind', width: 20 },
      { header: 'Часы', key: 'hours', width: 8 },
      { header: 'Ставка', key: 'rate', width: 10 },
      { header: 'Валюта', key: 'currency', width: 8 },
      { header: 'Стоимость', key: 'cost', width: 12 },
    ];

    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    rows.forEach((r: any) => ws.addRow(r));

    const totalRow = ws.addRow({
      requestName: 'ИТОГО',
      hours: rows.reduce((s: number, r: any) => s + Number(r.hours), 0),
      cost: rows.reduce((s: number, r: any) => s + Number(r.cost), 0),
    });
    totalRow.font = { bold: true };

    return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }

  // ── Funnel (now filterable by type) ─────────────────────────────────────
  async getFunnel(year?: number, month?: number, types?: string[]) {
    const params: any[] = [];
    const conds: string[] = [];

    if (year && month) {
      params.push(year);
      const yIdx = params.length;
      params.push(month);
      const mIdx = params.length;
      conds.push(`EXTRACT(YEAR FROM "createdAt") = $${yIdx} AND EXTRACT(MONTH FROM "createdAt") = $${mIdx}`);
    }

    if (types && types.length > 0) {
      params.push(types);
      conds.push(`type = ANY($${params.length})`);
    }

    const whereClause = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';

    const avgParams: any[] = [];
    const avgConds: string[] = [`status = 'done'`, `"closedAt" IS NOT NULL`];
    if (types && types.length > 0) {
      avgParams.push(types);
      avgConds.push(`type = ANY($${avgParams.length})`);
    }

    const [result, avgRow] = await Promise.all([
      this.dataSource.query(`
        SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('rejected','cancelled')) AS initiation,
          COUNT(*) FILTER (WHERE status IN ('queued','in_progress','rework','review','done')) AS design,
          COUNT(*) FILTER (WHERE status IN ('in_progress','rework','review','done')) AS development,
          COUNT(*) FILTER (WHERE status IN ('review','done')) AS testing,
          COUNT(*) FILTER (WHERE status = 'done') AS support,
          COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
          COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
          COUNT(*) AS total
        FROM requests
        ${whereClause}
      `, params),
      this.dataSource.query(`
        SELECT ROUND(AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 86400)::numeric, 1) as avg_days
        FROM requests WHERE ${avgConds.join(' AND ')}
      `, avgParams),
    ]);

    const r = result[0];
    return {
      stages: [
        { key: 'initiation', label: 'Инициирование', description: 'Бриф, экспресс-анализ', count: +r.initiation },
        { key: 'design', label: 'Проектирование', description: 'Дизайн, ТЗ', count: +r.design },
        { key: 'development', label: 'Разработка', description: 'ETL, визуализация', count: +r.development },
        { key: 'testing', label: 'Проверка', description: 'QA, согласование, протокол подписан', count: +r.testing },
        { key: 'support', label: 'Сопровождение', description: 'Публикация, поддержка', count: +r.support },
      ],
      rejected: +r.rejected,
      cancelled: +r.cancelled,
      total: +r.total,
      avgDays: avgRow[0]?.avg_days ? Number(avgRow[0].avg_days) : null,
    };
  }

  async getMonthlyReport(year: number, month: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const prevDate = new Date(year, month - 2, 1);
    const prevStartDate = new Date(prevDate.getFullYear(), prevDate.getMonth(), 1);
    const prevEndDate = startDate;
    const prevStartStr = prevStartDate.toISOString().split('T')[0];

    const [started, completed, hoursRow, byCustomer, byExecutor, byType, byStatus, prevRow] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*) as count FROM requests WHERE "createdAt" >= $1 AND "createdAt" < $2`,
        [startDate.toISOString(), endDate.toISOString()],
      ),
      this.dataSource.query(
        `SELECT COUNT(*) as count FROM requests WHERE status = 'done' AND "closedAt" >= $1 AND "closedAt" < $2`,
        [startDate.toISOString(), endDate.toISOString()],
      ),
      this.dataSource.query(
        `SELECT COALESCE(SUM(hours), 0) as total FROM time_entries WHERE date >= $1 AND date < $2`,
        [startStr, endStr],
      ),
      this.dataSource.query(
        `SELECT COALESCE(c.department, 'Не указан') as department,
                COUNT(DISTINCT r.id) as "requestCount",
                COALESCE(SUM(te.hours), 0) as hours
         FROM requests r
         LEFT JOIN customers c ON c.id = r."customerId"
         LEFT JOIN time_entries te ON te."requestId" = r.id AND te.date >= $1 AND te.date < $2
         WHERE r."createdAt" >= $3 AND r."createdAt" < $4
         GROUP BY c.department ORDER BY "requestCount" DESC LIMIT 10`,
        [startStr, endStr, startDate.toISOString(), endDate.toISOString()],
      ),
      this.dataSource.query(
        `SELECT COALESCE(u."fullName", con.name, 'Не указан') as name,
                COALESCE(SUM(te.hours), 0) as hours
         FROM time_entries te
         LEFT JOIN users u ON u.id = te."userId"
         LEFT JOIN contractors con ON con.id = te."contractorId"
         WHERE te.date >= $1 AND te.date < $2
         GROUP BY u."fullName", con.name ORDER BY hours DESC LIMIT 10`,
        [startStr, endStr],
      ),
      this.dataSource.query(
        `SELECT type, COUNT(*) as count FROM requests
         WHERE "createdAt" >= $1 AND "createdAt" < $2 GROUP BY type ORDER BY count DESC`,
        [startDate.toISOString(), endDate.toISOString()],
      ),
      this.dataSource.query(
        `SELECT status, COUNT(*) as count FROM requests
         WHERE "createdAt" >= $1 AND "createdAt" < $2 GROUP BY status`,
        [startDate.toISOString(), endDate.toISOString()],
      ),
      this.dataSource.query(
        `SELECT
          (SELECT COUNT(*) FROM requests WHERE "createdAt" >= $1 AND "createdAt" < $2) as started,
          (SELECT COUNT(*) FROM requests WHERE status = 'done' AND "closedAt" >= $1 AND "closedAt" < $2) as completed,
          (SELECT COALESCE(SUM(hours), 0) FROM time_entries WHERE date >= $3 AND date < $4) as "totalHours"
        `,
        [prevStartDate.toISOString(), prevEndDate.toISOString(), prevStartStr, startStr],
      ),
    ]);

    return {
      period: { year, month },
      started: +started[0].count,
      completed: +completed[0].count,
      totalHours: +hoursRow[0].total,
      prevStarted: +prevRow[0].started,
      prevCompleted: +prevRow[0].completed,
      prevTotalHours: +prevRow[0].totalHours,
      byCustomer,
      byExecutor,
      byType,
      byStatus,
    };
  }

  async getSlaReport(params: { dateFrom?: string; dateTo?: string }) {
    const from = params.dateFrom || new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
    const to = params.dateTo || new Date().toISOString().split('T')[0];
    const toEnd = to + ' 23:59:59';

    const [breachRows, nearBreachList, overdueList, monthlyRows, byPriority, byType] = await Promise.all([
      // Total closed requests in period + how many breached SLA
      this.dataSource.query(`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('done','rejected','cancelled')) AS "totalClosed",
          COUNT(*) FILTER (
            WHERE status IN ('done','rejected','cancelled')
              AND "plannedDate" IS NOT NULL
              AND "closedAt" IS NOT NULL
              AND "closedAt"::date > "plannedDate"::date
          ) AS "totalBreached"
        FROM requests
        WHERE "closedAt" BETWEEN $1 AND $2
      `, [from, toEnd]),

      // Active requests expiring within 3 days
      this.dataSource.query(`
        SELECT
          r.id, r.number, r.name, r.type, r.priority, r.status,
          r."plannedDate",
          (r."plannedDate"::date - CURRENT_DATE) AS "daysLeft",
          c.department AS "customerDept",
          u."fullName" AS "assigneeName"
        FROM requests r
        LEFT JOIN customers c ON c.id = r."customerId"
        LEFT JOIN users u ON u.id = r."assigneeId"
        WHERE r."plannedDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 days'
          AND r.status NOT IN ('done', 'rejected', 'cancelled', 'waiting_customer')
        ORDER BY r."plannedDate" ASC
        LIMIT 20
      `),

      // Currently overdue active requests
      this.dataSource.query(`
        SELECT
          r.id, r.number, r.name, r.type, r.priority, r.status,
          r."plannedDate",
          (CURRENT_DATE - r."plannedDate"::date) AS "overdueDays",
          c.department AS "customerDept",
          u."fullName" AS "assigneeName"
        FROM requests r
        LEFT JOIN customers c ON c.id = r."customerId"
        LEFT JOIN users u ON u.id = r."assigneeId"
        WHERE r."plannedDate" < CURRENT_DATE
          AND r.status NOT IN ('done', 'rejected', 'cancelled', 'waiting_customer')
        ORDER BY r."plannedDate" ASC
        LIMIT 30
      `),

      // 6-month SLA compliance trend
      this.dataSource.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', "closedAt"), 'YYYY-MM') AS month,
          COUNT(*) AS total,
          COUNT(*) FILTER (
            WHERE "plannedDate" IS NOT NULL
              AND "closedAt"::date <= "plannedDate"::date
          ) AS "onTime"
        FROM requests
        WHERE "closedAt" >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
          AND status IN ('done','rejected','cancelled')
        GROUP BY 1
        ORDER BY 1 ASC
      `),

      // Breach count by priority (closed in period)
      this.dataSource.query(`
        SELECT
          priority,
          COUNT(*) AS total,
          COUNT(*) FILTER (
            WHERE "plannedDate" IS NOT NULL
              AND "closedAt"::date > "plannedDate"::date
          ) AS breached
        FROM requests
        WHERE "closedAt" BETWEEN $1 AND $2
          AND status IN ('done','rejected','cancelled')
        GROUP BY priority
        ORDER BY priority
      `, [from, toEnd]),

      // Breach count by type (closed in period)
      this.dataSource.query(`
        SELECT
          type,
          COUNT(*) AS total,
          COUNT(*) FILTER (
            WHERE "plannedDate" IS NOT NULL
              AND "closedAt"::date > "plannedDate"::date
          ) AS breached
        FROM requests
        WHERE "closedAt" BETWEEN $1 AND $2
          AND status IN ('done','rejected','cancelled')
        GROUP BY type
        ORDER BY type
      `, [from, toEnd]),
    ]);

    const totalClosed = +breachRows[0].totalClosed || 0;
    const totalBreached = +breachRows[0].totalBreached || 0;
    const breachRate = totalClosed > 0 ? Math.round((totalBreached / totalClosed) * 100) : 0;

    const monthlyCompliance = monthlyRows.map((r: any) => ({
      month: r.month,
      total: +r.total,
      onTime: +r.onTime,
      compliance: +r.total > 0 ? Math.round((+r.onTime / +r.total) * 100) : 100,
    }));

    return {
      period: { from, to },
      breachRate,
      totalClosed,
      totalBreached,
      nearBreachList,
      overdueList,
      monthlyCompliance,
      byPriority: byPriority.map((r: any) => ({
        priority: r.priority,
        total: +r.total,
        breached: +r.breached,
        compliance: +r.total > 0 ? Math.round(((+r.total - +r.breached) / +r.total) * 100) : 100,
      })),
      byType: byType.map((r: any) => ({
        type: r.type,
        total: +r.total,
        breached: +r.breached,
        compliance: +r.total > 0 ? Math.round(((+r.total - +r.breached) / +r.total) * 100) : 100,
      })),
    };
  }
}
