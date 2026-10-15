import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class AppService implements OnModuleInit {
  private readonly logger = new Logger(AppService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit() {
    // Role migration (idempotent)
    try {
      const result = await this.dataSource.query(`
        UPDATE users
        SET role = CASE
          WHEN role IN ('initiator', 'developer', 'contractor_role') THEN 'executor'
          WHEN role = 'manager' THEN 'admin'
          ELSE role
        END
        WHERE role IN ('initiator', 'developer', 'contractor_role', 'manager')
      `);
      const count = result[1] ?? 0;
      if (count > 0) this.logger.log(`Роли мигрированы: ${count} пользователей`);
    } catch (e) {
      this.logger.warn(`Миграция ролей: ${e.message}`);
    }

    // Ensure activity_logs table exists (runs even when synchronize:false in production)
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS activity_logs (
          id           SERIAL PRIMARY KEY,
          "userId"     INTEGER,
          "userRole"   VARCHAR(32),
          "userName"   VARCHAR(150),
          event        VARCHAR(64) NOT NULL,
          "entityId"   INTEGER,
          "entityType" VARCHAR(32),
          "entityLabel" VARCHAR(300),
          meta         JSONB,
          ip           VARCHAR(64),
          "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_activity_logs_event      ON activity_logs (event);
        CREATE INDEX IF NOT EXISTS idx_activity_logs_user       ON activity_logs ("userId");
        CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs ("createdAt");
      `);
      this.logger.log('activity_logs table ready');
    } catch (e) {
      this.logger.error(`activity_logs table init failed: ${e.message}`);
    }

    // Ensure report_versions table exists (runs even when synchronize:false in production)
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS report_versions (
          id             SERIAL PRIMARY KEY,
          "reportId"     INTEGER NOT NULL REFERENCES reports_ref(id) ON DELETE CASCADE,
          "requestId"    INTEGER,
          version        VARCHAR(50),
          "changeSummary" TEXT,
          "createdAt"    TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_report_versions_report ON report_versions ("reportId")
      `);
      this.logger.log('report_versions table ready');
    } catch (e) {
      this.logger.error(`report_versions table init failed: ${e.message}`);
    }

    // Full-text search index for requests.findAll/findSimilar (name + description + number).
    // Expression must stay in sync with SEARCH_VECTOR_SQL in requests.service.ts.
    try {
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_requests_search ON requests
        USING GIN (to_tsvector('russian', coalesce(name,'') || ' ' || coalesce(description,'') || ' ' || coalesce(number,'')))
      `);
      this.logger.log('idx_requests_search ready');
    } catch (e) {
      this.logger.error(`idx_requests_search init failed: ${e.message}`);
    }

    // Atomic request numbering sequence (avoids race conditions on concurrent creates)
    try {
      await this.dataSource.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'request_number_seq') THEN
            EXECUTE format(
              'CREATE SEQUENCE request_number_seq START WITH %s',
              -- No ELSE branch: non-numeric numbers must resolve to NULL (which MAX ignores),
              -- not 0 — otherwise a table with only non-numeric numbers makes MAX(...)=0 and
              -- COALESCE never falls back to 999, starting the sequence at 1.
              (SELECT COALESCE(MAX(CASE WHEN number ~ '^[0-9]+$' THEN number::integer END), 999) + 1 FROM requests)
            );
          END IF;
        END
        $$;
      `);
      this.logger.log('request_number_seq ready');
    } catch (e) {
      this.logger.error(`request_number_seq init failed: ${e.message}`);
    }

    // "Заявитель другой" — request created by one staff member on behalf of another employee
    // (picked from the optional employee directory, see EmployeesService), who isn't necessarily a User.
    try {
      await this.dataSource.query(`
        ALTER TABLE requests ADD COLUMN IF NOT EXISTS "onBehalfOfName" VARCHAR(255);
        ALTER TABLE requests ADD COLUMN IF NOT EXISTS "onBehalfOfEmail" VARCHAR(255);
      `);
      this.logger.log('requests.onBehalfOf ready');
    } catch (e) {
      this.logger.error(`requests.onBehalfOf init failed: ${e.message}`);
    }

    // Billing companies — which legal entity a piece of work bills to (most dashboards go
    // through one default company; a separate line of dashboards bills a different one). Seeds
    // itself from the existing global act_* settings the first time it runs, so the "default"
    // company's requisites match whatever was already configured for acts — nothing to redo.
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS billing_companies (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          city VARCHAR(100),
          "directorPosition" VARCHAR(255),
          "directorName" VARCHAR(255),
          "isDefault" BOOLEAN NOT NULL DEFAULT false,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        ALTER TABLE requests ADD COLUMN IF NOT EXISTS "billingCompanyId" INTEGER REFERENCES billing_companies(id);
        ALTER TABLE reports_ref ADD COLUMN IF NOT EXISTS "billingCompanyId" INTEGER REFERENCES billing_companies(id);
        ALTER TABLE billing_companies ADD COLUMN IF NOT EXISTS "shortName" VARCHAR(100);
      `);

      // One-time backfill for rows created before shortName existed — pull the brand out of the
      // innermost «...» quotes in the legal name as a sensible default (admin can override it in
      // "Юрлица-плательщики" any time). New rows are expected to set it explicitly going forward.
      const unnamed = await this.dataSource.query(
        `SELECT id, name FROM billing_companies WHERE "shortName" IS NULL`,
      );
      for (const row of unnamed) {
        const lastOpen = row.name.lastIndexOf('«');
        const close = row.name.indexOf('»', lastOpen);
        const guess = (lastOpen !== -1 && close !== -1) ? row.name.slice(lastOpen + 1, close) : row.name;
        await this.dataSource.query(`UPDATE billing_companies SET "shortName" = $1 WHERE id = $2`, [guess, row.id]);
      }

      const [{ count }] = await this.dataSource.query(`SELECT COUNT(*)::int AS count FROM billing_companies`);
      if (count === 0) {
        const settingsRows = await this.dataSource.query(
          `SELECT key, value FROM settings WHERE key = ANY($1)`,
          [['act_city', 'act_customer_name', 'act_customer_director_position', 'act_customer_director_name']],
        );
        const s = Object.fromEntries(settingsRows.map((r: any) => [r.key, r.value]));
        const inserted = await this.dataSource.query(`
          INSERT INTO billing_companies (name, city, "directorPosition", "directorName", "isDefault")
          VALUES ($1, $2, $3, $4, true)
          RETURNING id
        `, [
          s.act_customer_name || 'ООО «Заказчик»',
          s.act_city || null,
          s.act_customer_director_position || 'Генерального директора',
          s.act_customer_director_name || null,
        ]);
        const defaultId = inserted[0].id;
        await this.dataSource.query(`UPDATE requests SET "billingCompanyId" = $1 WHERE "billingCompanyId" IS NULL`, [defaultId]);
        await this.dataSource.query(`UPDATE reports_ref SET "billingCompanyId" = $1 WHERE "billingCompanyId" IS NULL`, [defaultId]);
      }
      this.logger.log('billing_companies ready');
    } catch (e) {
      this.logger.error(`billing_companies init failed: ${e.message}`);
    }

    // Act generation: legal designation + contract reference per contractor
    try {
      await this.dataSource.query(`
        ALTER TABLE contractors ADD COLUMN IF NOT EXISTS "legalDesignation" TEXT;
        ALTER TABLE contractors ADD COLUMN IF NOT EXISTS "contractNumber" VARCHAR(100);
        ALTER TABLE contractors ADD COLUMN IF NOT EXISTS "contractDate" DATE;
      `);
      this.logger.log('contractors act columns ready');
    } catch (e) {
      this.logger.error(`contractors act columns init failed: ${e.message}`);
    }

    // Reports registry: "Владелец (бизнес)" reference list, linkable to a real user account.
    // (Starts empty — owners are added in the registry UI.)
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS report_owners (
          id         SERIAL PRIMARY KEY,
          "fullName" VARCHAR(255) NOT NULL UNIQUE,
          "userId"   INTEGER
        )
      `);
      await this.dataSource.query(`ALTER TABLE reports_ref ADD COLUMN IF NOT EXISTS "ownerId" INTEGER`);

      // Reconcile: collapse any owner entry into a real account with the exact same name —
      // covers accounts created (e.g. via SSO) since the last time this ran.
      await this.dataSource.query(`
        UPDATE report_owners ro SET "userId" = u.id
        FROM users u
        WHERE ro."fullName" = u."fullName" AND (ro."userId" IS NULL OR ro."userId" <> u.id)
      `);
      this.logger.log('report_owners ready');
    } catch (e) {
      this.logger.error(`report_owners init failed: ${e.message}`);
    }

    // Dashboard refresh log — written by an external job (cron, n8n, any script) via the HTTP
    // endpoint in dashboard-refresh-logs.controller.ts, not a direct DB connection.
    try {
      const oldSchema = await this.dataSource.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'dashboard_refresh_logs' AND column_name = 'report_name'
      `);
      if (oldSchema.length) {
        await this.dataSource.query(`DROP TABLE dashboard_refresh_logs`);
      }
    } catch (e) {
      this.logger.error(`dashboard_refresh_logs cleanup failed: ${e.message}`);
    }
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS dashboard_refresh_logs (
          id          SERIAL PRIMARY KEY,
          "reportName" TEXT NOT NULL,
          "lastStatus" TEXT NOT NULL,
          "checkedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_dashboard_refresh_logs_checked_at ON dashboard_refresh_logs ("checkedAt")
      `);
      // Best-effort match against reports_ref, set at ingest time (see dashboard-refresh-logs
      // controller) — the analytics query also re-matches live, so this is just a cache.
      await this.dataSource.query(`ALTER TABLE dashboard_refresh_logs ADD COLUMN IF NOT EXISTS "reportId" INTEGER`);
      // Manual name overrides for SSRS catalog names that don't textually match the registry.
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS dashboard_refresh_aliases (
          id           SERIAL PRIMARY KEY,
          "sourceName" TEXT NOT NULL UNIQUE,
          "reportId"   INTEGER NOT NULL REFERENCES reports_ref(id) ON DELETE CASCADE
        )
      `);
      // Some SSRS-catalog names are known-disabled dashboards (refresh intentionally turned
      // off) rather than a real incident — "excluded" rows have no reportId, they just suppress
      // the source name from the monitoring tables in dashboard-refresh-logs.controller.ts.
      await this.dataSource.query(`ALTER TABLE dashboard_refresh_aliases ALTER COLUMN "reportId" DROP NOT NULL`);
      await this.dataSource.query(`ALTER TABLE dashboard_refresh_aliases ADD COLUMN IF NOT EXISTS excluded BOOLEAN NOT NULL DEFAULT false`);
      this.logger.log('dashboard_refresh_logs ready');
    } catch (e) {
      this.logger.error(`dashboard_refresh_logs init failed: ${e.message}`);
    }

    // Team leads: managerId (admin-assigned) grants visibility into subordinates' costs and
    // combined Act generation — see users.service.ts / analytics.controller.ts / acts.controller.ts.
    try {
      await this.dataSource.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "managerId" INTEGER`);
      this.logger.log('users.managerId ready');
    } catch (e) {
      this.logger.error(`users.managerId init failed: ${e.message}`);
    }

    // Groups several external contractor logins under one counterparty — see contractor.entity.ts.
    try {
      await this.dataSource.query(`ALTER TABLE contractors ADD COLUMN IF NOT EXISTS "parentContractorId" INTEGER`);
      this.logger.log('contractors.parentContractorId ready');
    } catch (e) {
      this.logger.error(`contractors.parentContractorId init failed: ${e.message}`);
    }

    // Required reason + audit trail for reports_ref.status changes — see reports-ref.service.ts.
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS report_status_history (
          id             SERIAL PRIMARY KEY,
          "reportId"     INTEGER NOT NULL REFERENCES reports_ref(id) ON DELETE CASCADE,
          "oldStatus"    VARCHAR(50) NOT NULL,
          "newStatus"    VARCHAR(50) NOT NULL,
          reason         TEXT NOT NULL,
          "changedById"  INTEGER,
          "changedByName" VARCHAR(255),
          "createdAt"    TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_report_status_history_report ON report_status_history ("reportId")
      `);
      this.logger.log('report_status_history table ready');
    } catch (e) {
      this.logger.error(`report_status_history table init failed: ${e.message}`);
    }

    // Personal Telegram DMs (assignment + status change) — see TelegramService.
    try {
      await this.dataSource.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS "telegramChatId" VARCHAR(64);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS "telegramLinkToken" VARCHAR(64);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_link_token ON users ("telegramLinkToken") WHERE "telegramLinkToken" IS NOT NULL;
      `);
      this.logger.log('users.telegramChatId ready');
    } catch (e) {
      this.logger.error(`users.telegramChatId init failed: ${e.message}`);
    }

    // "На уточнении" and "Согласование" were folded into "Ожидание заказчика" / "На проверке" —
    // both were near-duplicates of the status they merged into everywhere they actually mattered
    // (SLA/escalation treatment, analytics grouping) and only added extra clicks to the
    // workflow. The `status` column is a native Postgres enum with `synchronize` on in prod, so
    // the enum values themselves stay defined (dropping enum members isn't a safe online
    // operation) — this just moves any row still sitting in one of the two old statuses onto its
    // replacement. Idempotent: a second run finds nothing left to move.
    try {
      const clarificationMoved = await this.dataSource.query(
        `UPDATE requests SET status = 'waiting_customer' WHERE status = 'clarification' RETURNING id`,
      );
      const approvalMoved = await this.dataSource.query(
        `UPDATE requests SET status = 'review' WHERE status = 'approval' RETURNING id`,
      );
      this.logger.log(`status consolidation ready (clarification→waiting_customer: ${clarificationMoved.length}, approval→review: ${approvalMoved.length})`);
    } catch (e) {
      this.logger.error(`status consolidation failed: ${e.message}`);
    }

    // The optional employee directory (see EmployeesService) is a read-only copy of an external
    // HR system. Some people have no email there, which excludes them from the "Заявитель другой"
    // picker (it requires an email to be reachable). This table lives in *this* app's own DB so a
    // manual fix survives the directory's next sync.
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS employee_email_overrides (
          inn         VARCHAR(32) PRIMARY KEY,
          email       VARCHAR(255) NOT NULL,
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      this.logger.log('employee_email_overrides table ready');
    } catch (e) {
      this.logger.error(`employee_email_overrides table init failed: ${e.message}`);
    }
  }
}
