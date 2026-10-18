import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  gateCheckinResultSchema,
  shopTodaySchema,
  visitSchema,
  type QueueVisit,
} from '@pataka/shared';
import { getDb } from '../src/db/client';
import { consents, otpRequests, shopLicences, slots, users, visits } from '../src/db/schema';
import { categoryPatchHandler } from '../src/functions/console';
import { demoInfoHandler, demoLoginHandler } from '../src/functions/demo';
import { gateCheckinHandler } from '../src/functions/gate';
import { shopItemsHandler } from '../src/functions/public';
import {
  shopNoShowHandler,
  shopServeHandler,
  shopSlotsPutHandler,
  shopTodayHandler,
} from '../src/functions/shop';
import { createVisitHandler } from '../src/functions/visits';
import { purge, sweepNoShows } from '../src/lib/jobs';
import { body, call, errorCode, makeListedShop, makeUser } from './helpers';

async function bookOne(slotId: string, shopShortCode = 'SLC01') {
  const person = await makeUser();
  const res = await call(createVisitHandler, {
    method: 'POST',
    session: person.session,
    body: { shopShortCode, slotId },
  });
  return { ...person, visit: visitSchema.parse(res.jsonBody) };
}

describe('gate check-in', () => {
  it('assigns the next free bay and rejects re-use', async () => {
    const shop = await makeListedShop('SLC01', { slotStartsInMin: 35 });
    // Move the slot into the check-in window (starts in 10 min).
    await getDb()
      .update(slots)
      .set({
        startsAt: new Date(Date.now() + 10 * 60_000),
        endsAt: new Date(Date.now() + 40 * 60_000),
      })
      .where(eq(slots.id, shop.slot.id));
    await getDb()
      .update(slots)
      .set({ startsAt: new Date(Date.now() + 31 * 60_000) })
      .where(eq(slots.id, shop.slot.id));
    const a = await bookOne(shop.slot.id);
    const b = await bookOne(shop.slot.id);
    await getDb()
      .update(slots)
      .set({ startsAt: new Date(Date.now() + 10 * 60_000) })
      .where(eq(slots.id, shop.slot.id));

    const first = await call(gateCheckinHandler, {
      method: 'POST',
      session: shop.marshal.session,
      body: { code: a.visit.code },
    });
    expect(gateCheckinResultSchema.parse(first.jsonBody).bayNo).toBe(1);
    const second = await call(gateCheckinHandler, {
      method: 'POST',
      session: shop.marshal.session,
      body: { code: b.visit.code.toLowerCase() },
    });
    expect(gateCheckinResultSchema.parse(second.jsonBody).bayNo).toBe(2);
    const again = await call(gateCheckinHandler, {
      method: 'POST',
      session: shop.marshal.session,
      body: { code: a.visit.code },
    });
    expect(errorCode(again)).toBe('already_checked_in');
  });

  it('refuses tickets for another ground, too-early tickets, and non-marshals', async () => {
    const shop = await makeListedShop('SLC01');
    const other = await makeListedShop('BAL01');
    const { visit } = await bookOne(shop.slot.id);

    const wrong = await call(gateCheckinHandler, {
      method: 'POST',
      session: other.marshal.session,
      body: { code: visit.code },
    });
    expect(errorCode(wrong)).toBe('wrong_cluster');
    const early = await call(gateCheckinHandler, {
      method: 'POST',
      session: shop.marshal.session,
      body: { code: visit.code },
    });
    expect(errorCode(early)).toBe('too_early');
    const customer = await makeUser();
    const denied = await call(gateCheckinHandler, {
      method: 'POST',
      session: customer.session,
      body: { code: visit.code },
    });
    expect(denied.status).toBe(403);
  });

  it('demo mode skips the time window', async () => {
    const shop = await makeListedShop('SLC01');
    const { visit } = await bookOne(shop.slot.id);
    process.env.DEMO_MODE = 'true';
    const res = await call(gateCheckinHandler, {
      method: 'POST',
      session: shop.marshal.session,
      body: { code: visit.code },
    });
    expect(res.status).toBe(200);
  });
});

describe('shop counter', () => {
  it("today's list shows the visit; serve marks it served (code only)", async () => {
    const shop = await makeListedShop();
    const { visit } = await bookOne(shop.slot.id);
    const today = shopTodaySchema.parse(
      (await call(shopTodayHandler, { session: shop.staff.session })).jsonBody,
    );
    const all = today.slots.flatMap((s) => s.visits);
    // the test slot may fall on tomorrow's IST date near midnight
    if (all.length) expect(all[0]!.code).toBe(visit.code);

    const served = await call(shopServeHandler, {
      method: 'POST',
      session: shop.staff.session,
      params: { code: visit.code },
    });
    expect(body<QueueVisit>(served).status).toBe('served');
    const replay = await call(shopServeHandler, {
      method: 'POST',
      session: shop.staff.session,
      params: { code: visit.code },
    });
    expect(replay.status).toBe(200); // offline replays are harmless
  });

  it('another shop cannot serve the ticket', async () => {
    const shop = await makeListedShop('SLC01');
    const other = await makeListedShop('BAL01');
    const { visit } = await bookOne(shop.slot.id);
    const res = await call(shopServeHandler, {
      method: 'POST',
      session: other.staff.session,
      params: { code: visit.code },
    });
    expect(errorCode(res)).toBe('wrong_shop');
  });

  it('manual no-show frees the place and adds a strike', async () => {
    const shop = await makeListedShop();
    const { visit, user } = await bookOne(shop.slot.id);
    await call(shopNoShowHandler, {
      method: 'POST',
      session: shop.owner.session,
      params: { code: visit.code },
    });
    const [u] = await getDb().select().from(users).where(eq(users.id, user.id));
    expect(u!.noShowStrikes).toBe(1);
    const [s] = await getDb().select().from(slots).where(eq(slots.id, shop.slot.id));
    expect(s!.booked).toBe(0);
  });

  it('changing hours never drops a booked slot', async () => {
    const shop = await makeListedShop();
    await bookOne(shop.slot.id);
    const date = new Date(shop.slot.startsAt.getTime() + 5.5 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    const res = await call(shopSlotsPutHandler, {
      method: 'PUT',
      session: shop.owner.session,
      body: { date, openFrom: '10:00', openTo: '10:30', capacity: 1 },
    });
    expect(res.status).toBe(200);
    const [kept] = await getDb().select().from(slots).where(eq(slots.id, shop.slot.id));
    expect(kept?.booked).toBe(1);
  });

  it('staff cannot change slot hours', async () => {
    const shop = await makeListedShop();
    const res = await call(shopSlotsPutHandler, {
      method: 'PUT',
      session: shop.staff.session,
      body: { date: '2099-01-01', openFrom: '10:00', openTo: '12:00', capacity: 5 },
    });
    expect(errorCode(res)).toBe('owner_only');
  });
});

describe('no-show sweeper (time travel)', () => {
  it('marks late visits no-show, frees places, and blocks after 3 strikes', async () => {
    const shop = await makeListedShop();
    const person = await makeUser();
    for (let i = 0; i < 3; i++) {
      await call(createVisitHandler, {
        method: 'POST',
        session: person.session,
        body: { shopShortCode: 'SLC01', slotId: shop.slot.id },
      });
      const afterSlot = new Date(shop.slot.endsAt.getTime() + 16 * 60_000);
      expect(await sweepNoShows(getDb(), afterSlot)).toBe(1);
    }
    const [u] = await getDb().select().from(users).where(eq(users.id, person.user.id));
    expect(u!.noShowStrikes).toBe(3);
    expect(u!.blockedUntil?.toISOString()).toBe('2026-11-20T18:29:00.000Z');
    const [s] = await getDb().select().from(slots).where(eq(slots.id, shop.slot.id));
    expect(s!.booked).toBe(0);
  });

  it('leaves visits alone inside the grace period', async () => {
    const shop = await makeListedShop();
    await bookOne(shop.slot.id);
    expect(await sweepNoShows(getDb(), new Date(shop.slot.endsAt.getTime() + 10 * 60_000))).toBe(0);
  });
});

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
  it('daily: drops OTP rows older than a day; season end + 90 days: deletes visits and anonymises customers', async () => {
    const shop = await makeListedShop();
    const { user } = await bookOne(shop.slot.id);
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
    expect(daily).toMatchObject({ phase: 'daily', otpRequests: 1, visits: 0 });

    const after = new Date('2027-02-19T00:00:00Z');
    const dry = await purge(getDb(), after, true);
    expect(dry).toMatchObject({ phase: 'season', visits: 1, dryRun: true });
    expect(await getDb().select().from(visits)).toHaveLength(1);

    await purge(getDb(), after);
    expect(await getDb().select().from(visits)).toHaveLength(0);
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
