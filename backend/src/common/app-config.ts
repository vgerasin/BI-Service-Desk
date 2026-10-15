/** Public base URL of the app — used in links inside e-mails and Telegram messages. */
export const getAppUrl = (): string =>
  (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

/** Product name shown in e-mails / bot messages. Override with APP_NAME. */
export const getAppName = (): string => process.env.APP_NAME || 'BI Service Desk';

/**
 * JWT signing secret. Required in production; in development a fixed insecure fallback keeps
 * `npm run start:dev` working without any setup.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is not set (or shorter than 16 characters). Set it in .env.');
  }
  return 'dev-only-insecure-secret-change-me';
}
