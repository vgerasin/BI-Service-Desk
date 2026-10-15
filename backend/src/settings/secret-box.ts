import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { getJwtSecret } from '../common/app-config';

/**
 * Encrypts integration secrets (SSO client secret, DB / SMTP passwords) before they go into the
 * `settings` table, so a DB dump or a JSON backup doesn't leak them in clear text.
 * AES-256-GCM, key derived from JWT_SECRET. If JWT_SECRET changes, stored secrets can no longer
 * be decrypted and must be entered again in Settings.
 */
const PREFIX = 'enc:v1:';

const key = () => createHash('sha256').update(`bi-service-desk:settings:${getJwtSecret()}`).digest();

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

/** Returns '' when the value is empty or cannot be decrypted. Legacy plain values pass through. */
export function decryptSecret(value: string | null | undefined): string {
  if (!value) return '';
  if (!value.startsWith(PREFIX)) return value;
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
