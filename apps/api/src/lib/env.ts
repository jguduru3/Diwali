import { istInstant } from '@pataka/shared';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const env = {
  jwtSecret(): Uint8Array {
    const secret = required('JWT_SECRET');
    if (!this.otpDevMode() && secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters outside dev mode');
    }
    return new TextEncoder().encode(secret);
  },
  /** "dev" | "prod" in Azure; unset locally. */
  isProd(): boolean {
    return process.env.APP_ENV === 'prod';
  },
  /** Dev mode: OTP is always 123456 and is logged, never sent. Never honoured in prod. */
  otpDevMode(): boolean {
    return process.env.OTP_DEV_MODE === 'true' && !this.isProd();
  },
  /**
   * Demo mode: one-tap "view as" sign-in for seeded accounts and a relaxed gate
   * time window, so every screen can be tried without SMS. Never enable in prod.
   */
  demoMode(): boolean {
    return process.env.DEMO_MODE === 'true' && !this.isProd();
  },
  /** Secure cookies everywhere except when explicitly disabled. */
  cookieSecure(): boolean {
    return process.env.COOKIE_SECURE !== 'false';
  },
  msg91(): { authKey: string; templateId: string } {
    return { authKey: required('MSG91_AUTH_KEY'), templateId: required('MSG91_TEMPLATE_ID') };
  },
  /** Last day of the season (IST). Blocks last until its end; purge runs 90 days later. */
  seasonEndDate(): string {
    return process.env.SEASON_END ?? '2026-11-20';
  },
  seasonEndInstant(): Date {
    return istInstant(this.seasonEndDate(), '23:59');
  },
  storageAccountName(): string | undefined {
    return process.env.STORAGE_ACCOUNT_NAME || undefined;
  },
  uploadDir(): string | undefined {
    return process.env.UPLOAD_DIR || undefined;
  },
};
