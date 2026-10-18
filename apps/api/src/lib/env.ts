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
  /**
   * L1 legal gate (SPEC_V3 §2): online ordering is off unless set. Bicep keeps it
   * off in prod until a written legal opinion clears it.
   */
  orderingEnabled(): boolean {
    return process.env.ORDERING_ENABLED === 'true';
  },
  /** Key for encrypting merchants' YouPI webhook secrets at rest. */
  merchantSecretsKey(): string {
    const key = process.env.MERCHANT_SECRETS_KEY;
    if (key && key.length >= 32) return key;
    if (this.isProd()) throw new Error('MERCHANT_SECRETS_KEY must be at least 32 characters');
    return 'dev-only-merchant-secrets-key-change-me-0000';
  },
  /** Simulated counter UPI for merchants without YouPI settings (never in prod). */
  mockCounterUpi(): boolean {
    return !this.isProd();
  },
  /** Public origin used in links given to merchants (webhook URL). */
  publicOrigin(): string {
    return process.env.PUBLIC_ORIGIN || (this.isProd() ? '' : 'http://localhost:5173');
  },
  /** Payment provider adapter name. The mock provider is refused in prod. */
  paymentProvider(): string {
    const name = process.env.PAYMENT_PROVIDER || 'mock';
    if (name === 'mock' && this.isProd())
      throw new Error('The mock payment provider is not allowed in prod');
    return name;
  },
  mockPaymentSecret(): string {
    if (this.isProd()) throw new Error('The mock payment provider is not allowed in prod');
    return process.env.MOCK_PAYMENT_SECRET || 'dev-only-mock-payment-secret';
  },
  storageAccountName(): string | undefined {
    return process.env.STORAGE_ACCOUNT_NAME || undefined;
  },
  uploadDir(): string | undefined {
    return process.env.UPLOAD_DIR || undefined;
  },
};
