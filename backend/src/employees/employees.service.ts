import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Pool } from 'pg';
import { IntegrationsService } from '../settings/integrations.service';

export interface EmployeeRow {
  inn: string;
  fullName: string;
  position: string | null;
  department: string | null;
  email: string | null;
  company: string | null;
  city: string | null;
  chief: string | null;
}

export interface OrgStructureNode {
  code: string;
  name: string;
  children: OrgStructureNode[];
}

// The synced "OrgStructure" table's own "Parent" column is useless for building a tree — every
// one of its 309 rows carries the literal string "2025" (looks like an org-structure "version
// year" tag from the source system, not an actual parent link). The real hierarchy is instead
// baked into "OrgUnitName" itself as a leading slash-separated numeric path, e.g.
// "02/04/02 Отдел казначейства" is a child of "02/04 Финансовый департамент" which is a child of
// "02 Корпоративный департамент". This regex splits that path from the human-readable label.
const ORG_CODE_RE = /^([0-9]+(?:\/[0-9]+)*)\/?\s*(.*)$/;

function toFullName(surName: string | null, name: string | null, middleName: string | null): string {
  return [surName, name, middleName].filter(Boolean).join(' ');
}

// Latest-snapshot-per-person slice of the "Sotrudniki" table (see docs/hr-directory.md, a
// daily full TRUNCATE+INSERT of the raw history table — every change to a person over time lands
// as its own row keyed by "Period", so "current" means DISTINCT ON ("INN") ordered by "Period"
// DESC). Callers still filter DateEnd IS NULL themselves for "active only", and HAS_EMAIL below
// where a result needs to be reachable (e.g. search(), used to pick a request's notification
// target) — not every query needs both.
const LATEST_ACTIVE_CTE = `
  WITH latest AS (
    SELECT DISTINCT ON ("INN")
      "INN", "SurName", "Name", "MiddleName", "Position", "Department", "Email",
      "Company", "City", "Chief", "OrgUnit", "DateEnd"
    FROM "Sotrudniki"
    WHERE "INN" IS NOT NULL
    ORDER BY "INN", "Period" DESC
  )
`;
const ROW_COLUMNS = `"INN", "SurName", "Name", "MiddleName", "Position", "Department", "Email", "Company", "City", "Chief"`;
const HAS_EMAIL = `"Email" IS NOT NULL AND "Email" <> ''`;

function toEmployeeRow(r: any): EmployeeRow {
  return {
    inn: r.INN,
    fullName: toFullName(r.SurName, r.Name, r.MiddleName),
    position: r.Position || null,
    department: r.Department || null,
    email: r.Email || null,
    company: r.Company || null,
    city: r.City || null,
    chief: r.Chief || null,
  };
}

// An optional, external Postgres database with the company's HR directory (see
// docs/hr-directory.md for the expected tables) — not this app's own database. Connection
// details come from Settings → «База сотрудников». Talked to directly via `pg.Pool` rather than a
// second TypeORM connection: a bare Pool connects lazily per-query, so a hiccup on this auxiliary
// DB can never block the whole app's bootstrap. When the integration is switched off every
// lookup simply returns an empty result and the UI hides the directory.
@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);
  private pool: Pool | null = null;
  private poolKey = '';

  // This app's own DB (not the external HR one) — holds employee_email_overrides, the only piece
  // of "employee data" that needs to survive the directory's own periodic sync.
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly integrations: IntegrationsService,
  ) {}

  async isEnabled(): Promise<boolean> {
    const c = await this.integrations.getHr();
    return c.enabled && !!c.host && !!c.database;
  }

  /** Pool for the saved settings, or null when the integration is off. Rebuilt when settings change. */
  private async getPool(): Promise<Pool | null> {
    const c = await this.integrations.getHr();
    if (!c.enabled || !c.host || !c.database) return null;
    const key = JSON.stringify(c);
    if (!this.pool || key !== this.poolKey) {
      void this.pool?.end().catch(() => undefined);
      this.pool = this.createPool(c);
      this.poolKey = key;
    }
    return this.pool;
  }

  private createPool(c: { host: string; port: number; database: string; user: string; password: string; ssl: boolean }): Pool {
    return new Pool({
      host: c.host, port: c.port, database: c.database, user: c.user || undefined, password: c.password || undefined,
      ssl: c.ssl ? { rejectUnauthorized: false } : undefined,
      max: 5,
      connectionTimeoutMillis: 5000,
    });
  }

  private async query(sql: string, params: any[]): Promise<any[]> {
    const pool = await this.getPool();
    if (!pool) return [];
    try {
      const { rows } = await pool.query(sql, params);
      return rows;
    } catch (e) {
      this.logger.error(`HR DB query failed: ${e.message}`);
      throw new ServiceUnavailableException('База сотрудников временно недоступна');
    }
  }

  /** «Проверить подключение» — tries the credentials from the form (or the saved ones). */
  async testConnection(override?: Partial<{ host: string; port: number; database: string; user: string; password: string; ssl: boolean }>) {
    const saved = await this.integrations.getHr();
    const c = {
      host: override?.host || saved.host,
      port: override?.port || saved.port,
      database: override?.database || saved.database,
      user: override?.user ?? saved.user,
      password: override?.password || saved.password,
      ssl: override?.ssl ?? saved.ssl,
    };
    if (!c.host || !c.database) return { ok: false, error: 'Укажите хост и имя базы' };
    const pool = this.createPool(c);
    try {
      await pool.query('SELECT 1');
      const { rows } = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('Sotrudniki', 'OrgStructure')`,
      );
      const found = rows.map((r) => r.table_name);
      const missing = ['Sotrudniki', 'OrgStructure'].filter((t) => !found.includes(t));
      return { ok: true, missingTables: missing };
    } catch (e: any) {
      return { ok: false, error: e.message };
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  // Powers the connection-status card on Настройки системы — deliberately doesn't reuse
  // `query()`'s throw-on-failure behavior: a status check should report "not connected" cleanly,
  // not blow up the page with a 503.
  async getStatus(): Promise<{
    enabled: boolean;
    connected: boolean;
    totalActive?: number;
    lastSync?: string | null;
    error?: string;
  }> {
    const pool = await this.getPool();
    if (!pool) return { enabled: false, connected: false };
    try {
      const { rows } = await pool.query(`
        ${LATEST_ACTIVE_CTE}
        SELECT
          (SELECT COUNT(*) FROM latest WHERE "DateEnd" IS NULL AND ${HAS_EMAIL})::int AS "totalActive",
          (SELECT MAX("Period") FROM "Sotrudniki") AS "lastSync"
      `);
      return { enabled: true, connected: true, totalActive: rows[0].totalActive, lastSync: rows[0].lastSync };
    } catch (e) {
      this.logger.error(`HR DB status check failed: ${e.message}`);
      return { enabled: true, connected: false, error: e.message };
    }
  }

  // Departments/divisions only, no employees — powers "Структура компании". Built from the
  // "OrgStructure" table (see ORG_CODE_RE above for why raw "Parent" is ignored).
  async getStructure(): Promise<OrgStructureNode[]> {
    const rows = await this.query(
      `SELECT "OrgUnitName" FROM "OrgStructure" WHERE "Disbanded" = 0 OR "Disbanded" IS NULL`,
      [],
    );

    const byCode = new Map<string, OrgStructureNode>();
    const parsed: { code: string; name: string }[] = [];
    for (const r of rows) {
      const m = ORG_CODE_RE.exec(r.OrgUnitName || '');
      const name = m?.[2]?.trim();
      if (!m || !name) continue; // drops the one stray "2025" row with no real label
      parsed.push({ code: m[1], name });
    }
    for (const p of parsed) byCode.set(p.code, { code: p.code, name: p.name, children: [] });

    const roots: OrgStructureNode[] = [];
    for (const p of parsed) {
      const node = byCode.get(p.code)!;
      const segments = p.code.split('/');
      const parentCode = segments.slice(0, -1).join('/');
      const parent = segments.length > 1 ? byCode.get(parentCode) : undefined;
      // Orphans (parent code doesn't exist as its own row) surface at the top level rather than
      // silently vanishing — data-quality drift in the source shouldn't hide a whole subtree.
      (parent ?? { children: roots }).children.push(node);
    }

    const byLastSegment = (a: OrgStructureNode, b: OrgStructureNode) =>
      Number(a.code.split('/').pop()) - Number(b.code.split('/').pop());
    const sortTree = (nodes: OrgStructureNode[]) => {
      nodes.sort(byLastSegment);
      for (const n of nodes) sortTree(n.children);
    };
    sortTree(roots);

    return roots;
  }

  // People in one node of "Структура компании" (and everything beneath it) — matched by
  // "Sotrudniki"."OrgUnit", which carries the exact same slash-coded path as
  // "OrgStructure"."OrgUnitName" (see ORG_CODE_RE), just per-person instead of per-department.
  // Deliberately NOT filtered by email like findAll/search — this view exists to answer "who's
  // actually in this department", and dropping people without an email would misrepresent the
  // department as smaller than it is (~2.5% of active staff have no email on file).
  async findByDepartment(code: string): Promise<EmployeeRow[]> {
    const rows = await this.query(`
      ${LATEST_ACTIVE_CTE},
      withcode AS (
        SELECT *, (regexp_match("OrgUnit", '^([0-9]+(?:/[0-9]+)*)'))[1] AS "orgCode"
        FROM latest WHERE "DateEnd" IS NULL
      )
      SELECT ${ROW_COLUMNS}
      FROM withcode
      WHERE "orgCode" = $1 OR "orgCode" LIKE $1 || '/%'
      ORDER BY "SurName", "Name"
      LIMIT 500
    `, [code]);
    return this.applyOverrides(rows.map(toEmployeeRow));
  }

  // Person-name search for the merged "Сотрудники" page (tree + list side by side) — unlike
  // search() below (used only by the "Заявитель другой" picker, which must stay email-only since
  // a requester needs to be reachable), this view is "who's in the company", so no-email people
  // are included too, matching findByDepartment's philosophy above.
  async searchAll(q: string): Promise<EmployeeRow[]> {
    const like = `%${q.trim()}%`;
    const rows = await this.query(`
      ${LATEST_ACTIVE_CTE}
      SELECT ${ROW_COLUMNS}
      FROM latest
      WHERE "DateEnd" IS NULL
        AND ("SurName" ILIKE $1 OR "Name" ILIKE $1)
      ORDER BY "SurName", "Name"
      LIMIT 300
    `, [like]);
    return this.applyOverrides(rows.map(toEmployeeRow));
  }

  // Fills in an email for anyone in `rows` who came back from HR without one but has a manual
  // override on file — cheap no-op (skips the query) for the common case of a fully-emailed page.
  private async applyOverrides(rows: EmployeeRow[]): Promise<EmployeeRow[]> {
    const missing = [...new Set(rows.filter((r) => !r.email).map((r) => r.inn))];
    if (!missing.length) return rows;
    const overrides = await this.dataSource.query(
      `SELECT inn, email FROM employee_email_overrides WHERE inn = ANY($1)`,
      [missing],
    );
    if (!overrides.length) return rows;
    const byInn = new Map<string, string>(overrides.map((o: any) => [o.inn, o.email]));
    return rows.map((r) => (!r.email && byInn.has(r.inn) ? { ...r, email: byInn.get(r.inn)! } : r));
  }

  // Manual fix for the ~2.5% of active staff the HR export has no email for — see
  // employee_email_overrides in app.service.ts. Upserts so re-setting the same person just
  // updates it rather than erroring on the existing primary key.
  async setEmailOverride(inn: string, email: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO employee_email_overrides (inn, email, "updatedAt") VALUES ($1, $2, NOW())
       ON CONFLICT (inn) DO UPDATE SET email = EXCLUDED.email, "updatedAt" = NOW()`,
      [inn, email],
    );
  }

  // Powers the "Заявитель другой" picker on Requests → Новая заявка — starts-with match (not
  // substring) on either surname or first name, since that's how people actually type while
  // looking someone up, and email-required since the result becomes a request's notification
  // target. Doesn't filter by HAS_EMAIL in SQL (unlike before) because a manual override in
  // employee_email_overrides can supply the email HR itself doesn't have — applyOverrides fills
  // those in first, and only THEN do we drop anyone still unreachable either way.
  async search(q: string): Promise<EmployeeRow[]> {
    const like = `${q.trim()}%`;
    const rows = await this.query(`
      ${LATEST_ACTIVE_CTE}
      SELECT ${ROW_COLUMNS}
      FROM latest
      WHERE "DateEnd" IS NULL
        AND ("SurName" ILIKE $1 OR "Name" ILIKE $1)
      ORDER BY "SurName", "Name"
      LIMIT 40
    `, [like]);
    const withOverrides = await this.applyOverrides(rows.map(toEmployeeRow));
    return withOverrides.filter((r) => !!r.email).slice(0, 20);
  }

  // Bulk email -> {department, fullName} lookup — powers grouping ratings by real org department
  // AND naming who left them (see AnalyticsService.getRatingMetrics) instead of the sparsely-
  // filled customers.department, since most requesters are internal staff (createdBy /
  // "заявитель другой"), not portal Customer records. Keyed lowercase since email casing isn't
  // guaranteed consistent between this app's own users/requests tables and the HR export.
  async findByEmails(emails: string[]): Promise<Map<string, { department: string | null; fullName: string }>> {
    const unique = [...new Set(emails.filter(Boolean).map(e => e.toLowerCase()))];
    const map = new Map<string, { department: string | null; fullName: string }>();
    if (!unique.length) return map;
    const rows = await this.query(`
      ${LATEST_ACTIVE_CTE}
      SELECT LOWER("Email") AS email, "Department" AS department, "SurName", "Name", "MiddleName"
      FROM latest
      WHERE "DateEnd" IS NULL AND LOWER("Email") = ANY($1)
    `, [unique]);
    for (const r of rows) {
      map.set(r.email, { department: r.department || null, fullName: toFullName(r.SurName, r.Name, r.MiddleName) });
    }
    return map;
  }
}
