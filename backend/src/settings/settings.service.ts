import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from './setting.entity';
import { decryptSecret, encryptSecret } from './secret-box';

@Injectable()
export class SettingsService {
  constructor(@InjectRepository(Setting) private repo: Repository<Setting>) {}

  async get(key: string, fallback?: string): Promise<string | undefined> {
    const row = await this.repo.findOne({ where: { key } });
    return row?.value ?? fallback;
  }

  async getMany(keys: string[]): Promise<Record<string, string | null>> {
    const rows = await this.repo.find({ where: keys.map(k => ({ key: k })) });
    const map: Record<string, string | null> = {};
    for (const k of keys) map[k] = null;
    for (const row of rows) map[row.key] = row.value;
    return map;
  }

  async set(key: string, value: string | null): Promise<void> {
    const existing = await this.repo.findOne({ where: { key } });
    if (existing) {
      existing.value = value;
      await this.repo.save(existing);
    } else {
      await this.repo.save(this.repo.create({ key, value }));
    }
  }

  async setMany(values: Record<string, string | null>): Promise<void> {
    await Promise.all(Object.entries(values).map(([k, v]) => this.set(k, v)));
  }

  /** Reads a value written with setSecret() (decrypted). Empty string when not set. */
  async getSecret(key: string): Promise<string> {
    return decryptSecret(await this.get(key));
  }

  /** Stores a value encrypted. null / '' clears it. */
  async setSecret(key: string, value: string | null): Promise<void> {
    await this.set(key, value ? encryptSecret(value) : null);
  }
}
