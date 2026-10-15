import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomBytes } from 'crypto';
import { SettingsService } from './settings.service';

/* ──────────────────────────────────────────────────────────────────────────
 * Integration settings. Everything an operator used to put into code or .env
 * (SSO provider, employee-directory database, SMTP, dashboard-refresh feed)
 * lives in the `settings` table and is edited on «Настройки системы».
 * Secrets are stored encrypted (see secret-box.ts) and are never sent back to the UI.
 * ────────────────────────────────────────────────────────────────────────── */

export interface SsoConfig {
  enabled: boolean;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  tokenAuth: 'body' | 'basic';
  userinfoScheme: string;
  map: { id: string; email: string; fullName: string; firstName: string; lastName: string; middleName: string; position: string };
  defaultRole: 'customer' | 'executor';
}

export interface HrConfig {
  enabled: boolean;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: 'none' | 'starttls' | 'ssl';
  user: string;
  password: string;
  from: string;
  rejectUnauthorized: boolean;
}

export interface RefreshConfig {
  enabled: boolean;
  checkTime: string; // HH:mm — when the external job normally reports
  timezone: string;  // IANA zone of checkTime
}

const SSO_KEYS = [
  'sso_enabled', 'sso_label', 'sso_authorize_url', 'sso_token_url', 'sso_userinfo_url', 'sso_client_id',
  'sso_scope', 'sso_token_auth', 'sso_userinfo_scheme', 'sso_default_role',
  'sso_map_id', 'sso_map_email', 'sso_map_full_name', 'sso_map_first_name', 'sso_map_last_name',
  'sso_map_middle_name', 'sso_map_position',
];
const HR_KEYS = ['hr_enabled', 'hr_host', 'hr_port', 'hr_database', 'hr_user', 'hr_ssl'];
const SMTP_KEYS = ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from', 'smtp_reject_unauthorized'];
const REFRESH_KEYS = ['refresh_enabled', 'refresh_check_time', 'refresh_timezone'];

const on = (v: string | null | undefined, dflt = false) => (v == null || v === '' ? dflt : v === '1');
const flag = (b: boolean) => (b ? '1' : '0');

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly settings: SettingsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /* ── SSO ───────────────────────────────────────────────────────────── */

  async getSso(): Promise<SsoConfig> {
    const v = await this.settings.getMany(SSO_KEYS);
    return {
      enabled: on(v.sso_enabled),
      label: v.sso_label || 'Войти через SSO',
      authorizeUrl: v.sso_authorize_url || '',
      tokenUrl: v.sso_token_url || '',
      userinfoUrl: v.sso_userinfo_url || '',
      clientId: v.sso_client_id || '',
      clientSecret: await this.settings.getSecret('sso_client_secret'),
      scope: v.sso_scope ?? 'openid profile email',
      tokenAuth: v.sso_token_auth === 'basic' ? 'basic' : 'body',
      userinfoScheme: v.sso_userinfo_scheme || 'Bearer',
      defaultRole: v.sso_default_role === 'executor' ? 'executor' : 'customer',
      map: {
        id: v.sso_map_id || 'sub',
        email: v.sso_map_email || 'email',
        fullName: v.sso_map_full_name ?? 'name',
        firstName: v.sso_map_first_name ?? 'given_name',
        lastName: v.sso_map_last_name ?? 'family_name',
        middleName: v.sso_map_middle_name ?? '',
        position: v.sso_map_position ?? '',
      },
    };
  }

  /** Config as shown on the settings page — no secret. */
  async getSsoForAdmin() {
    const cfg = await this.getSso();
    const { clientSecret, ...rest } = cfg;
    const [row] = await this.dataSource.query(`
      SELECT COUNT(*) FILTER (WHERE sso_subject IS NOT NULL) AS linked, COUNT(*) AS total FROM users
    `);
    return {
      ...rest,
      hasClientSecret: !!clientSecret,
      configured: !!(cfg.authorizeUrl && cfg.tokenUrl && cfg.userinfoUrl && cfg.clientId && clientSecret),
      linkedUsers: parseInt(row.linked, 10),
      totalUsers: parseInt(row.total, 10),
    };
  }

  /** Public part, used by the login page. */
  async getSsoPublic() {
    const c = await this.getSso();
    const ready = c.enabled && !!(c.authorizeUrl && c.tokenUrl && c.userinfoUrl && c.clientId && c.clientSecret);
    return ready
      ? { enabled: true, label: c.label, authorizeUrl: c.authorizeUrl, clientId: c.clientId, scope: c.scope }
      : { enabled: false };
  }

  async saveSso(b: Partial<SsoConfig> & { clientSecret?: string }) {
    const t = (s: any) => (typeof s === 'string' ? s.trim() : '');
    const m = b.map || ({} as SsoConfig['map']);
    await this.settings.setMany({
      sso_enabled: flag(!!b.enabled),
      sso_label: t(b.label) || null,
      sso_authorize_url: t(b.authorizeUrl) || null,
      sso_token_url: t(b.tokenUrl) || null,
      sso_userinfo_url: t(b.userinfoUrl) || null,
      sso_client_id: t(b.clientId) || null,
      sso_scope: typeof b.scope === 'string' ? b.scope.trim() : null,
      sso_token_auth: b.tokenAuth === 'basic' ? 'basic' : 'body',
      sso_userinfo_scheme: t(b.userinfoScheme) || null,
      sso_default_role: b.defaultRole === 'executor' ? 'executor' : 'customer',
      sso_map_id: t(m.id) || null,
      sso_map_email: t(m.email) || null,
      sso_map_full_name: typeof m.fullName === 'string' ? m.fullName.trim() : null,
      sso_map_first_name: typeof m.firstName === 'string' ? m.firstName.trim() : null,
      sso_map_last_name: typeof m.lastName === 'string' ? m.lastName.trim() : null,
      sso_map_middle_name: typeof m.middleName === 'string' ? m.middleName.trim() : null,
      sso_map_position: typeof m.position === 'string' ? m.position.trim() : null,
    });
    // undefined / '' = keep the stored secret
    if (typeof b.clientSecret === 'string' && b.clientSecret !== '') {
      await this.settings.setSecret('sso_client_secret', b.clientSecret);
    }
  }

  /* ── Employee directory (external PostgreSQL) ──────────────────────── */

  async getHr(): Promise<HrConfig> {
    const v = await this.settings.getMany(HR_KEYS);
    return {
      enabled: on(v.hr_enabled),
      host: v.hr_host || '',
      port: parseInt(v.hr_port || '5432', 10) || 5432,
      database: v.hr_database || '',
      user: v.hr_user || '',
      password: await this.settings.getSecret('hr_password'),
      ssl: on(v.hr_ssl),
    };
  }

  async getHrForAdmin() {
    const { password, ...rest } = await this.getHr();
    return { ...rest, hasPassword: !!password };
  }

  async saveHr(b: Partial<HrConfig>) {
    const t = (s: any) => (typeof s === 'string' ? s.trim() : '');
    await this.settings.setMany({
      hr_enabled: flag(!!b.enabled),
      hr_host: t(b.host) || null,
      hr_port: String(parseInt(String(b.port ?? 5432), 10) || 5432),
      hr_database: t(b.database) || null,
      hr_user: t(b.user) || null,
      hr_ssl: flag(!!b.ssl),
    });
    if (typeof b.password === 'string' && b.password !== '') {
      await this.settings.setSecret('hr_password', b.password);
    }
  }

  /* ── SMTP (falls back to SMTP_* environment variables) ─────────────── */

  async getSmtp(): Promise<SmtpConfig> {
    const v = await this.settings.getMany(SMTP_KEYS);
    const secure = (v.smtp_secure || (process.env.SMTP_SECURE ?? '')) as string;
    const port = parseInt(v.smtp_port || process.env.SMTP_PORT || '587', 10) || 587;
    return {
      host: v.smtp_host || process.env.SMTP_HOST || '',
      port,
      secure: secure === 'ssl' || secure === 'none' || secure === 'starttls' ? secure : (port === 465 ? 'ssl' : 'starttls'),
      user: v.smtp_user || process.env.SMTP_USER || '',
      password: (await this.settings.getSecret('smtp_password')) || process.env.SMTP_PASS || '',
      from: v.smtp_from || process.env.SMTP_FROM || '',
      rejectUnauthorized: on(v.smtp_reject_unauthorized, true),
    };
  }

  async getSmtpForAdmin() {
    const { password, ...rest } = await this.getSmtp();
    return { ...rest, hasPassword: !!password };
  }

  async saveSmtp(b: Partial<SmtpConfig>) {
    const t = (s: any) => (typeof s === 'string' ? s.trim() : '');
    await this.settings.setMany({
      smtp_host: t(b.host) || null,
      smtp_port: String(parseInt(String(b.port ?? 587), 10) || 587),
      smtp_secure: b.secure === 'ssl' || b.secure === 'none' ? b.secure : 'starttls',
      smtp_user: t(b.user) || null,
      smtp_from: t(b.from) || null,
      smtp_reject_unauthorized: flag(b.rejectUnauthorized !== false),
    });
    if (typeof b.password === 'string' && b.password !== '') {
      await this.settings.setSecret('smtp_password', b.password);
    }
  }

  /* ── Dashboard-refresh monitoring (external job pushes failures over HTTP) ── */

  /** The shared secret an external job (n8n, cron, ...) must send in `x-log-secret`. */
  async getRefreshSecret(): Promise<string> {
    return (await this.settings.getSecret('refresh_secret')) || process.env.DASHBOARD_LOG_SECRET || '';
  }

  async getRefresh(): Promise<RefreshConfig> {
    const v = await this.settings.getMany(REFRESH_KEYS);
    // An existing deployment that already feeds the log through DASHBOARD_LOG_SECRET keeps working.
    const dflt = !!process.env.DASHBOARD_LOG_SECRET;
    return {
      enabled: on(v.refresh_enabled, dflt),
      checkTime: v.refresh_check_time || '10:30',
      timezone: v.refresh_timezone || 'Europe/Moscow',
    };
  }

  async getRefreshForAdmin() {
    return { ...(await this.getRefresh()), hasSecret: !!(await this.getRefreshSecret()) };
  }

  async saveRefresh(b: Partial<RefreshConfig>) {
    await this.settings.setMany({
      refresh_enabled: flag(!!b.enabled),
      refresh_check_time: /^\d{2}:\d{2}$/.test(b.checkTime || '') ? b.checkTime! : '10:30',
      refresh_timezone: (b.timezone || 'Europe/Moscow').trim(),
    });
  }

  /** Generates a new ingest secret and returns it ONCE (it is stored encrypted). */
  async rotateRefreshSecret(): Promise<string> {
    const secret = randomBytes(24).toString('hex');
    await this.settings.setSecret('refresh_secret', secret);
    return secret;
  }

  /* ── Feature flags for the UI ──────────────────────────────────────── */

  async getFeatures() {
    const [hr, refresh] = await Promise.all([this.getHr(), this.getRefresh()]);
    return {
      hrDirectory: hr.enabled && !!hr.host && !!hr.database,
      dashboardRefresh: refresh.enabled,
      dashboardRefreshCheckTime: refresh.checkTime,
      dashboardRefreshTimezone: refresh.timezone,
    };
  }
}
