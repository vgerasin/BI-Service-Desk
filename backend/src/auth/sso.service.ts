import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { IntegrationsService, SsoConfig } from '../settings/integrations.service';

export interface SsoProfile {
  subject: string;
  email: string | null;
  fullName: string;
  position: string | null;
}

/** Reads "a.b.c" from a parsed JSON object. Returns '' when missing. */
function pick(obj: any, path: string): string {
  if (!path) return '';
  const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  return v == null || typeof v === 'object' ? '' : String(v).trim();
}

/**
 * Generic OAuth 2.0 "authorization code" login. Everything provider-specific — endpoints, client
 * credentials, how the profile JSON maps to a user — comes from Settings → SSO, not from code.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(private readonly integrations: IntegrationsService) {}

  private async requireConfig(): Promise<SsoConfig> {
    const cfg = await this.integrations.getSso();
    const ready = cfg.enabled && cfg.tokenUrl && cfg.userinfoUrl && cfg.clientId && cfg.clientSecret;
    if (!ready) throw new UnauthorizedException('SSO не настроен');
    return cfg;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    const cfg = await this.requireConfig();
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (cfg.tokenAuth === 'basic') {
      headers.Authorization = 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
    } else {
      body.set('client_id', cfg.clientId);
      body.set('client_secret', cfg.clientSecret);
    }

    const res = await fetch(cfg.tokenUrl, {
      method: 'POST', headers, body: body.toString(), signal: AbortSignal.timeout(10_000),
    }).catch((e) => { throw new UnauthorizedException(`SSO: провайдер недоступен (${e.message})`); });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`SSO token exchange failed (${res.status}): ${text.slice(0, 300)}`);
      throw new UnauthorizedException(`SSO: не удалось обменять код на токен (${res.status})`);
    }
    const data: any = await res.json().catch(() => ({}));
    if (!data.access_token) throw new UnauthorizedException('SSO: провайдер не вернул access_token');
    return data.access_token;
  }

  async getProfile(accessToken: string): Promise<SsoProfile> {
    const cfg = await this.requireConfig();
    const res = await fetch(cfg.userinfoUrl, {
      headers: { Authorization: `${cfg.userinfoScheme} ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    }).catch((e) => { throw new UnauthorizedException(`SSO: провайдер недоступен (${e.message})`); });
    if (!res.ok) throw new UnauthorizedException(`SSO: не удалось получить профиль (${res.status})`);

    const data: any = await res.json().catch(() => ({}));
    const m = cfg.map;
    const subject = pick(data, m.id);
    if (!subject) throw new UnauthorizedException(`SSO: в ответе нет идентификатора пользователя (поле «${m.id}»)`);

    const fullName = pick(data, m.fullName)
      || [pick(data, m.lastName), pick(data, m.firstName), pick(data, m.middleName)].filter(Boolean).join(' ')
      || 'SSO User';
    return {
      subject,
      email: pick(data, m.email) || null,
      fullName,
      position: pick(data, m.position) || null,
    };
  }
}
