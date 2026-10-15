import { Client } from 'pg';

/**
 * Raw-SQL steps that must run BEFORE TypeORM's `synchronize` — otherwise synchronize would drop
 * a renamed column (and its data) instead of renaming it. Every step is idempotent and silent
 * on a fresh database.
 */
export async function runPreMigrations(databaseUrl: string | undefined): Promise<void> {
  if (!databaseUrl) return;
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    // users.ferrum_user_guid → users.sso_subject (provider-neutral SSO id)
    const { rows } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
        AND column_name IN ('ferrum_user_guid', 'sso_subject')
    `);
    const cols = rows.map((r) => r.column_name);
    if (cols.includes('ferrum_user_guid') && !cols.includes('sso_subject')) {
      await client.query(`ALTER TABLE users RENAME COLUMN ferrum_user_guid TO sso_subject`);
      await client.query(`ALTER TABLE users ALTER COLUMN sso_subject TYPE VARCHAR(255)`);
    }
  } catch (e) {
    // Fresh DB (no users table yet) or no permissions — nothing to migrate.
  } finally {
    await client.end().catch(() => undefined);
  }
}
