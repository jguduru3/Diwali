import { istInstant, PLATFORM_FEE_PAISE } from '@pataka/shared';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** Whole-number setting with a default and limits; a bad value fails loudly at use. */
function intSetting(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  }
  return n;
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
  /** Secure cookies everywhere except when explicitly disabled (always on with SameSite=None). */
  cookieSecure(): boolean {
    return process.env.COOKIE_SECURE !== 'false' || this.cookieSameSiteNone();
  },
  /** COOKIE_SAMESITE=None when the web app is served from a different site than the API. */
  cookieSameSiteNone(): boolean {
    return process.env.COOKIE_SAMESITE?.toLowerCase() === 'none';
  },
  /** 'msg91' sends customer SMS; 'log' (the default outside production) only logs them. */
  smsProvider(): 'msg91' | 'log' {
    const v = (process.env.SMS_PROVIDER || (this.isProd() ? 'msg91' : 'log')).toLowerCase();
    if (v !== 'msg91' && v !== 'log') throw new Error('SMS_PROVIDER must be msg91 or log');
    return v;
  },
  smsMsg91(): { authKey: string; templates: Record<'order_changed', string> } {
    return {
      authKey: required('MSG91_AUTH_KEY'),
      templates: { order_changed: process.env.MSG91_ORDER_CHANGED_TEMPLATE_ID ?? '' },
    };
  },
  /** Masked shop → customer calls: 'exotel' places them, 'log' prints, 'off' hides the button. */
  callProvider(): 'exotel' | 'log' | 'off' {
    const v = (process.env.CALL_PROVIDER || (this.isProd() ? 'off' : 'log')).toLowerCase();
    if (v !== 'exotel' && v !== 'log' && v !== 'off')
      throw new Error('CALL_PROVIDER must be exotel, log or off');
    if (v === 'log' && this.isProd()) throw new Error('CALL_PROVIDER=log is not allowed in prod');
    return v;
  },
  exotel(): { sid: string; apiKey: string; apiToken: string; callerId: string; host: string } {
    // Key Vault holds "not-set" for a secret nobody gave
    const given = (name: string) => {
      const v = required(name);
      if (v === 'not-set') throw new Error(`${name} is not set`);
      return v;
    };
    return {
      sid: given('EXOTEL_SID'),
      apiKey: given('EXOTEL_API_KEY'),
      apiToken: given('EXOTEL_API_TOKEN'),
      callerId: given('EXOTEL_CALLER_ID'),
      host: process.env.EXOTEL_API_HOST || 'api.exotel.com',
    };
  },
  /** Minimum minutes between two "your order changed" SMS for the same order. */
  orderChangedSmsGapMinutes(): number {
    return intSetting('ORDER_CHANGED_SMS_GAP_MINUTES', 15, 0, 24 * 60);
  },
  /** Minutes an order may wait for its platform fee before it is cancelled. */
  unpaidOrderTtlMinutes(): number {
    return intSetting('UNPAID_ORDER_TTL_MINUTES', 60, 5, 7 * 24 * 60);
  },
  /** The flat platform fee per order, in paise (G3; ₹30 unless the owner changes it). */
  platformFeePaise(): number {
    return intSetting('PLATFORM_FEE_PAISE', PLATFORM_FEE_PAISE, 100, 100_000);
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
  /** Razorpay keys (Key Vault). The key ID shows whether they are test or live keys. */
  razorpay(): { keyId: string; keySecret: string; webhookSecret: string } {
    const keyId = required('RAZORPAY_KEY_ID');
    if (this.isProd() && !keyId.startsWith('rzp_live_'))
      throw new Error('Production needs live Razorpay keys (rzp_live_…)');
    return {
      keyId,
      keySecret: required('RAZORPAY_KEY_SECRET'),
      webhookSecret: required('RAZORPAY_WEBHOOK_SECRET'),
    };
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
