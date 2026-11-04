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
  MSG91_ORDER_CHANGED_TEMPLATE_ID: 'tpl-order',
  SMS_PROVIDER: 'msg91',
  PAYMENT_PROVIDER: 'razorpay',
  RAZORPAY_KEY_ID: 'rzp_live_abc',
  RAZORPAY_KEY_SECRET: 'secret',
  RAZORPAY_WEBHOOK_SECRET: 'whsec',
};
const EXOTEL_NAMES = ['EXOTEL_SID', 'EXOTEL_API_KEY', 'EXOTEL_API_TOKEN', 'EXOTEL_CALLER_ID'];
const saved = { ...process.env };
beforeEach(() => Object.assign(process.env, LIVE));
afterEach(() => {
  for (const k of [
    ...Object.keys(LIVE),
    'PLATFORM_FEE_PAISE',
    'UNPAID_ORDER_TTL_MINUTES',
    'ORDER_CHANGED_SMS_GAP_MINUTES',
    ...EXOTEL_NAMES,
    'CALL_PROVIDER',
  ])
    delete process.env[k];
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

  it('needs the order-change SMS set up and valid number settings', () => {
    Object.assign(process.env, {
      SMS_PROVIDER: 'log',
      MSG91_ORDER_CHANGED_TEMPLATE_ID: '',
      PLATFORM_FEE_PAISE: 'thirty',
      UNPAID_ORDER_TTL_MINUTES: '1',
    });
    expect(productionProblems()).toEqual([
      'SMS_PROVIDER must be msg91 in production',
      'MSG91_ORDER_CHANGED_TEMPLATE_ID is needed to tell customers about order changes',
      'PLATFORM_FEE_PAISE is not a valid number',
      'UNPAID_ORDER_TTL_MINUTES is not a valid number',
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

  it('calling is optional, but once on it needs every Exotel setting', () => {
    process.env.CALL_PROVIDER = 'off';
    expect(productionProblems()).toEqual([]);
    process.env.CALL_PROVIDER = 'exotel';
    for (const n of EXOTEL_NAMES) process.env[n] = 'x';
    expect(productionProblems()).toEqual([]);
    // Key Vault holds "not-set" for a secret nobody gave
    process.env.EXOTEL_API_TOKEN = 'not-set';
    expect(productionProblems()).toEqual([
      'EXOTEL_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN and EXOTEL_CALLER_ID are needed to place calls',
    ]);
    process.env.CALL_PROVIDER = 'log';
    expect(productionProblems()).toContain('CALL_PROVIDER=log is not allowed in prod');
  });
});
