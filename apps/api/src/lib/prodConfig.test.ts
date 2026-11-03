import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { productionProblems } from './prodConfig';

const LIVE = {
  APP_ENV: 'prod',
  DEMO_MODE: 'false',
  OTP_DEV_MODE: 'false',
  DATABASE_URL: 'postgres://x',
  STORAGE_ACCOUNT_NAME: 'stdata',
  SEASON_END: '2026-11-20',
  JWT_SECRET: 'j'.repeat(40),
  MERCHANT_SECRETS_KEY: 'm'.repeat(40),
  PUBLIC_ORIGIN: 'https://pickup.example.in',
  MSG91_AUTH_KEY: 'key',
  MSG91_TEMPLATE_ID: 'tpl',
  PAYMENT_PROVIDER: 'razorpay',
  RAZORPAY_KEY_ID: 'rzp_live_abc',
  RAZORPAY_KEY_SECRET: 'secret',
  RAZORPAY_WEBHOOK_SECRET: 'whsec',
};
const saved = { ...process.env };
beforeEach(() => Object.assign(process.env, LIVE));
afterEach(() => {
  for (const k of Object.keys(LIVE)) delete process.env[k];
  Object.assign(process.env, saved);
});

describe('production readiness', () => {
  it('passes a complete live configuration', () => {
    expect(productionProblems()).toEqual([]);
  });

  it('names every missing or unsafe setting', () => {
    Object.assign(process.env, {
      DEMO_MODE: 'true',
      MSG91_AUTH_KEY: 'not-set',
      PAYMENT_PROVIDER: 'mock',
      PUBLIC_ORIGIN: 'http://x',
      JWT_SECRET: 'short',
    });
    expect(productionProblems()).toEqual([
      'DEMO_MODE must be false',
      'JWT_SECRET needs at least 32 characters',
      'PUBLIC_ORIGIN must be https://…',
      'MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are needed to send sign-in codes',
      'PAYMENT_PROVIDER must be razorpay',
    ]);
  });

  it('refuses Razorpay test keys in production', () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_abc';
    expect(productionProblems()).toEqual(['Production needs live Razorpay keys (rzp_live_…)']);
  });

  it('checks nothing outside production', () => {
    process.env.APP_ENV = 'dev';
    process.env.DEMO_MODE = 'true';
    expect(productionProblems()).toEqual([]);
  });
});
