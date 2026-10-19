import { describe, expect, it } from 'vitest';
import { assertConfig, checkConfig } from './config';

const good = {
  APP_ENV: 'prod',
  DATABASE_URL: 'postgres://x',
  JWT_SECRET: 'j'.repeat(40),
  MERCHANT_SECRETS_KEY: 'm'.repeat(40),
  MSG91_AUTH_KEY: 'a',
  MSG91_TEMPLATE_ID: 't',
  PUBLIC_ORIGIN: 'https://diwali.example',
  VAPID_PUBLIC_KEY: 'p',
  VAPID_PRIVATE_KEY: 'k',
};

describe('production config check', () => {
  it('is quiet outside prod', () => {
    expect(checkConfig({})).toEqual({ errors: [], warnings: [] });
  });

  it('passes a complete prod config; ordering off is only a warning', () => {
    const r = checkConfig(good);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([expect.stringMatching(/ordering is off/i)]);
    expect(() => assertConfig(() => {}, good)).not.toThrow();
  });

  it('refuses ordering with the mock fee provider in prod (L1/G3)', () => {
    const r = checkConfig({ ...good, ORDERING_ENABLED: 'true' });
    expect(r.errors).toEqual([expect.stringMatching(/PAYMENT_PROVIDER/)]);
    expect(
      checkConfig({ ...good, ORDERING_ENABLED: 'true', PAYMENT_PROVIDER: 'razorpay' }).errors,
    ).toEqual([]);
  });

  it('flags missing secrets, dev switches and placeholder SMS keys', () => {
    const r = checkConfig({
      APP_ENV: 'prod',
      JWT_SECRET: 'short',
      MSG91_AUTH_KEY: 'not-set',
      DEMO_MODE: 'true',
      OTP_DEV_MODE: 'true',
      COOKIE_SECURE: 'false',
    });
    expect(r.errors).toHaveLength(7);
    expect(r.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/VAPID/),
        expect.stringMatching(/PUBLIC_ORIGIN/),
      ]),
    );
    expect(() => assertConfig(() => {}, { APP_ENV: 'prod' })).toThrow(/Configuration errors/);
  });
});
