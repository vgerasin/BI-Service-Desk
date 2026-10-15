import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { User } from '../users/user.entity';
import { Customer } from '../customers/customer.entity';
import { Contractor } from '../contractors/contractor.entity';
import { Dictionary } from '../dictionaries/dictionary.entity';
import { ReportRef } from '../reports-ref/report-ref.entity';
import { BiRequest } from '../requests/request.entity';
import { TimeEntry } from '../time-entries/time-entry.entity';
import { Artifact } from '../requests/artifact.entity';
import { Activity } from '../requests/activity.entity';
import { RateHistory } from '../users/rate-history.entity';
import { RequestRating } from '../ratings/request-rating.entity';
import { BillingCompany } from '../billing-companies/billing-company.entity';
import { KnownError } from '../known-errors/known-error.entity';
import { DataSource as DataSourceEntity } from '../data-sources/data-source.entity';
import { ReportOwner } from '../report-owners/report-owner.entity';

// 1.1 → 1.2: added billing_companies, known_errors, data_sources, report_owners,
// dashboard_refresh_logs, dashboard_refresh_aliases — all added to the schema after 1.1 was
// cut, and silently absent from every export since (a full restore was quietly losing all of
// them). `|| []` on every new field below keeps a genuine 1.1 file importable — it just leaves
// those tables empty, same as they'd start on a fresh install.
const BACKUP_VERSION = '1.2';

// `manager.createQueryBuilder().insert().into(Entity).values(rows).execute()` looked like it
// should preserve the original ids from the backup (that was the whole point — every table here
// gets referenced by id from several other tables) but it silently doesn't: TypeORM omits
// @PrimaryGeneratedColumn from the generated INSERT's column list entirely, so every row lands
// with a fresh id from the sequence instead of the one in the backup — verified by logging the
// actual SQL (`INSERT INTO "users"("fullName", "email", ...)`, no `"id"` anywhere) and the
// post-insert ids (9 real users came back as 35-43). Every foreign key in the restored data —
// assigneeId, customerId, reportId, userId on rate_history, all of it — would silently point at
// the wrong rows. Raw SQL built straight from TypeORM's own column metadata sidesteps the bug
// and stays self-maintaining as the schema grows (no hand-kept column list to fall out of sync).
async function insertPreservingIds(manager: EntityManager, EntityClass: any, rows: any[]) {
  if (!rows?.length) return;
  const meta = manager.getRepository(EntityClass).metadata;
  // A column can appear twice in metadata when a relation's @JoinColumn shares a db column with
  // a plain @Column of the same name (e.g. RateHistory.userId) — de-dupe by db column name.
  const seen = new Map<string, string>();
  for (const c of meta.columns) if (!seen.has(c.databaseName)) seen.set(c.databaseName, c.propertyName);
  const cols = Array.from(seen.entries()); // [dbColumnName, jsPropertyName][]
  const colList = cols.map(([dbName]) => `"${dbName}"`).join(', ');
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const values: any[] = [];
    const placeholders = batch.map((row, ri) => {
      const base = ri * cols.length;
      const ph = cols.map((_, ci) => `$${base + ci + 1}`);
      for (const [, prop] of cols) values.push(row[prop] ?? null);
      return `(${ph.join(', ')})`;
    }).join(', ');
    await manager.query(`INSERT INTO "${meta.tableName}" (${colList}) VALUES ${placeholders}`, values);
  }
}

// dashboard_refresh_logs / dashboard_refresh_aliases are raw-SQL tables (see
// AppService.onModuleInit) with no TypeORM entity, so they don't have metadata to build the
// column list from — a small hand-rolled version of the same idea, columns given explicitly.
async function insertRaw(manager: EntityManager, table: string, columns: string[], rows: any[]) {
  if (!rows?.length) return;
  const colList = columns.map(c => `"${c}"`).join(', ');
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const values: any[] = [];
    const placeholders = batch.map((row, ri) => {
      const base = ri * columns.length;
      const ph = columns.map((c, ci) => { values.push(row[c] ?? null); return `$${base + ci + 1}`; });
      return `(${ph.join(', ')})`;
    }).join(', ');
    await manager.query(`INSERT INTO ${table} (${colList}) VALUES ${placeholders}`, values);
  }
}

@Injectable()
export class BackupService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(Customer) private customersRepo: Repository<Customer>,
    @InjectRepository(Contractor) private contractorsRepo: Repository<Contractor>,
    @InjectRepository(Dictionary) private dictRepo: Repository<Dictionary>,
    @InjectRepository(ReportRef) private reportsRepo: Repository<ReportRef>,
    @InjectRepository(BiRequest) private requestsRepo: Repository<BiRequest>,
    @InjectRepository(TimeEntry) private timeEntriesRepo: Repository<TimeEntry>,
    @InjectRepository(Artifact) private artifactsRepo: Repository<Artifact>,
    @InjectRepository(Activity) private activitiesRepo: Repository<Activity>,
    @InjectRepository(RateHistory) private ratesRepo: Repository<RateHistory>,
    @InjectRepository(RequestRating) private ratingsRepo: Repository<RequestRating>,
    @InjectRepository(BillingCompany) private billingCompaniesRepo: Repository<BillingCompany>,
    @InjectRepository(KnownError) private knownErrorsRepo: Repository<KnownError>,
    @InjectRepository(DataSourceEntity) private dataSourcesRepo: Repository<DataSourceEntity>,
    @InjectRepository(ReportOwner) private reportOwnersRepo: Repository<ReportOwner>,
    private dataSource: DataSource,
  ) {}

  async exportAll() {
    const [
      users, customers, contractors, dictionaries,
      reports, requests, timeEntries, artifacts, activities, rates, ratings,
      billingCompanies, knownErrors, dataSources, reportOwners,
      dashboardRefreshLogs, dashboardRefreshAliases,
    ] = await Promise.all([
      // Plain find() silently omits passwordHash (select: false on the column, added later to
      // keep it out of ordinary API responses — see user.entity.ts) — a backup is the one
      // legitimate, admin-only case that actually needs it: restoring from one had been quietly
      // wiping every local-login user's password, since NULL replaced the real hash on import.
      this.usersRepo.createQueryBuilder('u').addSelect('u.passwordHash').getMany(),
      this.customersRepo.find(),
      this.contractorsRepo.find(),
      this.dictRepo.find(),
      this.reportsRepo.find(),
      this.requestsRepo.find(),
      this.timeEntriesRepo.find(),
      this.artifactsRepo.find(),
      this.activitiesRepo.find(),
      this.ratesRepo.find(),
      this.ratingsRepo.find(),
      this.billingCompaniesRepo.find(),
      this.knownErrorsRepo.find(),
      this.dataSourcesRepo.find(),
      this.reportOwnersRepo.find(),
      this.dataSource.query(`SELECT * FROM dashboard_refresh_logs`),
      this.dataSource.query(`SELECT * FROM dashboard_refresh_aliases`),
    ]);

    return {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      counts: {
        users: users.length, customers: customers.length,
        contractors: contractors.length, dictionaries: dictionaries.length,
        reports: reports.length, requests: requests.length,
        timeEntries: timeEntries.length, artifacts: artifacts.length,
        activities: activities.length, rates: rates.length,
        ratings: ratings.length,
        billingCompanies: billingCompanies.length, knownErrors: knownErrors.length,
        dataSources: dataSources.length, reportOwners: reportOwners.length,
        dashboardRefreshLogs: dashboardRefreshLogs.length,
        dashboardRefreshAliases: dashboardRefreshAliases.length,
      },
      data: {
        users, customers, contractors, dictionaries,
        reports, requests, timeEntries, artifacts, activities, rates, ratings,
        billingCompanies, knownErrors, dataSources, reportOwners,
        dashboardRefreshLogs, dashboardRefreshAliases,
      },
    };
  }

  async importAll(backup: any) {
    if (!backup?.version || !backup?.data) {
      throw new BadRequestException('Неверный формат файла резервной копии');
    }

    const { data } = backup;

    await this.dataSource.transaction(async manager => {
      // Clear all tables in reverse FK order. dashboard_refresh_aliases has a real FK to
      // reports_ref, so it must go before reports_ref; everything else here is either a leaf or
      // (billing_companies) referenced by requests/reports_ref, so it comes out before those two
      // via CASCADE and goes back in before them below.
      await manager.query(`
        TRUNCATE TABLE
          dashboard_refresh_aliases, dashboard_refresh_logs,
          request_ratings, activities, artifacts, time_entries, requests,
          reports_ref, rate_history, users, contractors,
          customers, dictionaries, known_errors, data_sources, report_owners,
          billing_companies
        CASCADE
      `);

      const insert = (EntityClass: any, rows: any[]) => insertPreservingIds(manager, EntityClass, rows);

      await insert(Customer, data.customers);
      await insert(Contractor, data.contractors);
      await insert(User, data.users);
      // Before ReportRef/BiRequest — both carry an FK to billing_companies.
      await insert(BillingCompany, data.billingCompanies || []);
      await insert(DataSourceEntity, data.dataSources || []);
      await insert(RateHistory, data.rates);
      await insert(Dictionary, data.dictionaries);
      await insert(ReportOwner, data.reportOwners || []);
      await insert(ReportRef, data.reports);
      await insert(BiRequest, data.requests);
      await insert(TimeEntry, data.timeEntries);
      await insert(Artifact, data.artifacts);
      await insert(Activity, data.activities);
      await insert(RequestRating, data.ratings || []);
      await insert(KnownError, data.knownErrors || []);
      // Raw-SQL tables (no TypeORM entity) — dashboard_refresh_aliases has a real FK to
      // reports_ref, so it must land after ReportRef above.
      await insertRaw(manager, 'dashboard_refresh_logs',
        ['id', 'reportName', 'lastStatus', 'checkedAt', 'reportId'], data.dashboardRefreshLogs || []);
      await insertRaw(manager, 'dashboard_refresh_aliases',
        ['id', 'sourceName', 'reportId', 'excluded'], data.dashboardRefreshAliases || []);

      // Reset all sequences to max inserted ID
      const sequences: [string, string][] = [
        ['customers', 'id'], ['contractors', 'id'], ['users', 'id'],
        ['rate_history', 'id'], ['dictionaries', 'id'], ['reports_ref', 'id'],
        ['requests', 'id'], ['time_entries', 'id'],
        ['artifacts', 'id'], ['activities', 'id'],
        ['request_ratings', 'id'],
        ['billing_companies', 'id'], ['data_sources', 'id'], ['report_owners', 'id'],
        ['known_errors', 'id'], ['dashboard_refresh_logs', 'id'], ['dashboard_refresh_aliases', 'id'],
      ];
      for (const [table, col] of sequences) {
        await manager.query(
          `SELECT setval(pg_get_serial_sequence('"${table}"', '${col}'), COALESCE((SELECT MAX("${col}") FROM "${table}"), 1))`,
        );
      }
    });
  }
}
