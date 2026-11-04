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
  SUPPLIER_GSTIN: '36AAPFU0939F1ZW',
  SUPPLIER_ADDRESS: 'Hyderabad, Telangana',
};
const saved = { ...process.env };
beforeEach(() => Object.assign(process.env, LIVE));
afterEach(() => {
  for (const k of [
    ...Object.keys(LIVE),
    'PLATFORM_FEE_PAISE',
    'UNPAID_ORDER_TTL_MINUTES',
    'ORDER_CHANGED_SMS_GAP_MINUTES',
    'COOKIE_SECURE',
    'DATABASE_SSL',
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
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

  it('refuses insecure cookies or database TLS off in production', () => {
    process.env.COOKIE_SECURE = 'false';
    process.env.DATABASE_SSL = 'false';
    expect(productionProblems()).toEqual([
      'COOKIE_SECURE must not be false in prod',
      'DATABASE_SSL must not be false in prod',
    ]);
  });

  it('push is optional, but its VAPID keys come as a pair', () => {
    process.env.VAPID_PUBLIC_KEY = 'not-set';
    process.env.VAPID_PRIVATE_KEY = 'not-set';
    expect(productionProblems()).toEqual([]);
    process.env.VAPID_PUBLIC_KEY = 'BPub';
    expect(productionProblems()).toEqual([
      'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together for push notifications',
    ]);
    process.env.VAPID_PRIVATE_KEY = 'priv';
    expect(productionProblems()).toEqual([]);
  });

  it('tax invoices need the platform GSTIN and address', () => {
    process.env.SUPPLIER_GSTIN = 'NOT-A-GSTIN';
    delete process.env.SUPPLIER_ADDRESS;
    expect(productionProblems()).toEqual([
      'SUPPLIER_GSTIN must be a valid GSTIN for tax invoices',
      'SUPPLIER_ADDRESS is needed on tax invoices',
    ]);
  });
});
