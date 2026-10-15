import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityLog, ActivityEvent } from './activity-log.entity';

export { ActivityEvent };

export interface LogDto {
  userId?: number;
  userRole?: string;
  userName?: string;
  event: string;
  entityId?: number;
  entityType?: string;
  entityLabel?: string;
  meta?: Record<string, any>;
  ip?: string;
}

@Injectable()
export class ActivityLogsService {
  private readonly logger = new Logger(ActivityLogsService.name);

  constructor(
    @InjectRepository(ActivityLog)
    private readonly repo: Repository<ActivityLog>,
  ) {}

  async log(dto: LogDto): Promise<void> {
    try {
      await this.repo.save(this.repo.create(dto));
    } catch (e) {
      // Never crash the main request flow over a logging failure — but a silent catch here
      // previously made real failures indistinguishable from "nothing happened yet".
      this.logger.error(`Failed to save activity log (event=${dto.event}, userId=${dto.userId}): ${e.message}`);
    }
  }

  async findAll(filters: {
    userId?: number;
    event?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
  }) {
    const limit = 50;
    const page = filters.page || 1;
    const qb = this.repo.createQueryBuilder('l').orderBy('l.createdAt', 'DESC');
    if (filters.userId) qb.andWhere('l.userId = :uid', { uid: filters.userId });
    if (filters.event) qb.andWhere('l.event = :event', { event: filters.event });
    if (filters.dateFrom) qb.andWhere('l.createdAt >= :from', { from: filters.dateFrom });
    if (filters.dateTo) qb.andWhere('l.createdAt < :to', { to: filters.dateTo + 'T23:59:59' });
    const [items, total] = await qb.skip((page - 1) * limit).take(limit).getManyAndCount();
    return { items, total, page, limit };
  }

  async getStats() {
    const [heatmap, topRequests, activeUsers, dailyActiveUsers, eventCounts, todayRows] =
      await Promise.all([
        // hour×weekday heat for last 30 days
        this.repo.query(`
          SELECT
            EXTRACT(DOW FROM "createdAt")  AS dow,
            EXTRACT(HOUR FROM "createdAt") AS hour,
            COUNT(*)::int                   AS count
          FROM activity_logs
          WHERE "createdAt" >= NOW() - INTERVAL '30 days'
          GROUP BY dow, hour
        `),

        // top-10 most-viewed requests (last 30 days) — joined against requests so a deleted
        // request's old view history doesn't linger in this list forever; r.name (current)
        // instead of the entityLabel snapshot, so a renamed request shows its current title.
        this.repo.query(`
          SELECT r.id, r.name, COUNT(*)::int AS views
          FROM activity_logs l
          JOIN requests r ON r.id = l."entityId"
          WHERE l.event = 'request_viewed'
            AND l."createdAt" >= NOW() - INTERVAL '30 days'
          GROUP BY r.id, r.name
          ORDER BY views DESC
          LIMIT 10
        `),

        // Users with activity in the last 30 days, most recent first.
        this.repo.query(`
          SELECT u.id, u."fullName", u.email, u.role,
            MAX(l."createdAt") AS "lastActivity"
          FROM users u
          JOIN activity_logs l ON l."userId" = u.id
          WHERE u."isActive" = true
            AND l."createdAt" >= NOW() - INTERVAL '30 days'
          GROUP BY u.id, u."fullName", u.email, u.role
          ORDER BY "lastActivity" DESC
        `),

        // Distinct active users per day, last 30 days — a session can span a whole day of use
        // without a fresh login_success event (JWT stays valid), so counting logins alone
        // under-reports days where people were clearly active in the app.
        this.repo.query(`
          SELECT DATE("createdAt") AS date, COUNT(DISTINCT "userId")::int AS count
          FROM activity_logs
          WHERE "createdAt" >= NOW() - INTERVAL '30 days' AND "userId" IS NOT NULL
          GROUP BY DATE("createdAt")
          ORDER BY date
        `),

        // event counts last 30 days
        this.repo.query(`
          SELECT event, COUNT(*)::int AS count
          FROM activity_logs
          WHERE "createdAt" >= NOW() - INTERVAL '30 days'
          GROUP BY event
          ORDER BY count DESC
        `),

        // today quick stats
        this.repo.query(`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE event = 'login_success')::int  AS logins,
            COUNT(*) FILTER (WHERE event = 'request_viewed')::int AS views,
            COUNT(*) FILTER (WHERE event = 'export_excel')::int   AS exports
          FROM activity_logs
          WHERE "createdAt" >= CURRENT_DATE
        `),
      ]);

    return {
      heatmap,
      topRequests,
      activeUsers,
      dailyActiveUsers,
      eventCounts,
      todayStats: todayRows[0] ?? { total: 0, logins: 0, views: 0, exports: 0 },
    };
  }
}
