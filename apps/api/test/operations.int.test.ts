import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { consents, orders, otpRequests, shopLicences, users } from '../src/db/schema';
import { categoryPatchHandler } from '../src/functions/console';
import { demoInfoHandler, demoLoginHandler } from '../src/functions/demo';
import { shopItemsHandler } from '../src/functions/public';
import { purge } from '../src/lib/jobs';
import { body, call, makeListedShop, makeUser } from './helpers';
import { paidOrder } from './orderHelpers';

describe('banning a category', () => {
  it('takes its items off public price lists', async () => {
    const shop = await makeListedShop();
    const admin = await makeUser('admin');
    await call(categoryPatchHandler, {
      method: 'PATCH',
      session: admin.session,
      params: { id: shop.allowedCategory.id },
      body: { isBanned: true, bannedReason: 'test' },
    });
    const res = await call(shopItemsHandler, { params: { code: 'SLC01' } });
    expect(body<{ items: unknown[] }>(res).items).toHaveLength(0);
  });
});

describe('purge (G9)', () => {
  it('daily: drops OTP rows older than a day; season end + 90 days: anonymises customers, keeps orders', async () => {
    const shop = await makeListedShop();
    const { customer, order } = await paidOrder(shop);
    const user = customer.user;
    await getDb().insert(consents).values({ userId: user.id, purpose: 'x', version: 'v' });
    await getDb()
      .insert(otpRequests)
      .values({
        phoneE164: '+919999999999',
        codeHash: 'x',
        expiresAt: new Date(),
        createdAt: new Date(Date.now() - 2 * 86_400_000),
      });

    const daily = await purge(getDb(), new Date());
    expect(daily).toMatchObject({ phase: 'daily', otpRequests: 1, customersAnonymised: 0 });

    const after = new Date('2027-02-19T00:00:00Z');
    const dry = await purge(getDb(), after, true);
    expect(dry).toMatchObject({ phase: 'season', dryRun: true });
    expect(dry.customersAnonymised).toBeGreaterThan(0);

    await purge(getDb(), after);
    // Orders are financial records: kept, linked only to the anonymised user.
    expect(await getDb().select().from(orders).where(eq(orders.id, order.id))).toHaveLength(1);
    const [u] = await getDb().select().from(users).where(eq(users.id, user.id));
    expect(u!.phoneE164).toBe(`purged:${user.id}`);
    const [staff] = await getDb().select().from(users).where(eq(users.id, shop.owner.user.id));
    expect(staff!.deletedAt).toBeNull();
    const [c] = await getDb().select().from(consents).where(eq(consents.userId, user.id));
    expect(c!.withdrawnAt).not.toBeNull();
    expect(await getDb().select().from(shopLicences)).toHaveLength(1);
  });
});

describe('demo mode', () => {
  it('is off unless DEMO_MODE=true', async () => {
    expect(body<{ enabled: boolean }>(await call(demoInfoHandler)).enabled).toBe(false);
    const res = await call(demoLoginHandler, { method: 'POST', body: { phone: '+919000000001' } });
    expect(res.status).toBe(404);
  });

  it('is never honoured in prod, even if DEMO_MODE=true', async () => {
    process.env.DEMO_MODE = 'true';
    process.env.APP_ENV = 'prod';
    try {
      expect(body<{ enabled: boolean }>(await call(demoInfoHandler)).enabled).toBe(false);
    } finally {
      delete process.env.APP_ENV;
    }
  });

  it('signs in as a seeded demo account with one tap, and only those', async () => {
    process.env.DEMO_MODE = 'true';
    await getDb()
      .insert(users)
      .values([
        { phoneE164: '+919000000001', role: 'admin', displayName: 'Admin' },
        { phoneE164: '+919876543210', role: 'admin', displayName: 'Real admin' },
      ]);
    const info = body<{ accounts: { phone: string }[] }>(await call(demoInfoHandler));
    expect(info.accounts.map((a) => a.phone)).toEqual(['+919000000001']);
    const ok = await call(demoLoginHandler, { method: 'POST', body: { phone: '+919000000001' } });
    expect(ok.status).toBe(200);
    const real = await call(demoLoginHandler, { method: 'POST', body: { phone: '+919876543210' } });
    expect(real.status).toBe(403);
  });
});
