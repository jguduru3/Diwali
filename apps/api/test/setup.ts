import { afterAll, beforeEach, inject } from 'vitest';

process.env.DATABASE_URL = inject('databaseUrl');
process.env.DATABASE_SSL = 'false';
process.env.JWT_SECRET = 'integration-test-secret-integration-test-secret';
process.env.OTP_DEV_MODE = 'true';
process.env.COOKIE_SECURE = 'false';
process.env.DEMO_MODE = 'false';
process.env.SEASON_END = '2026-11-20';
process.env.ORDERING_ENABLED = 'true';
process.env.PAYMENT_PROVIDER = 'mock';
process.env.MOCK_PAYMENT_SECRET = 'integration-mock-payment-secret';
process.env.MERCHANT_SECRETS_KEY = 'integration-merchant-secrets-key-0123456789';
process.env.UPLOAD_DIR = `${process.env.TMPDIR ?? process.env.TEMP ?? '/tmp'}/diwali-express-test-uploads`;

const { closeDb, getPool } = await import('../src/db/client');

beforeEach(async () => {
  process.env.DEMO_MODE = 'false';
  await getPool().query(`truncate
    audit_log, rate_limits, otp_requests, consents, daily_shop_stats,
    counter_payment_events, counter_payments, fee_payment_events, fee_refunds, fee_payments,
    order_events, order_lines, orders, merchant_payment_settings, shop_counters,
    items, shop_price_versions, categories, shop_licences, shop_members, cluster_marshals,
    shops, clusters, users restart identity cascade`);
});

afterAll(async () => {
  await closeDb();
});
