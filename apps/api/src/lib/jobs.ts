// Scheduled jobs (SPEC §8 "Timer functions"). Each takes `now` so tests can time-travel.
import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { addDays, istDate } from '@pataka/shared';
import type { Db } from '../db/client';
import {
  consents,
  dailyShopStats,
  otpRequests,
  rateLimits,
  shopLicences,
  shops,
  users,
} from '../db/schema';
import { audit } from './audit';
import { env } from './env';
import { footfall } from './reports';

/** Licences past valid_to become expired, which drops the shop from visible_shops. */
export async function expireLicences(db: Db, now = new Date()): Promise<number> {
  const rows = await db
    .update(shopLicences)
    .set({ status: 'expired' })
    .where(
      and(
        ne(shopLicences.status, 'expired'),
        ne(shopLicences.status, 'rejected'),
        lt(shopLicences.validTo, istDate(now)),
      ),
    )
    .returning({ id: shopLicences.id });
  return rows.length;
}

/** Persists the day's footfall so reports survive the end-of-season purge. */
export async function snapshotDailyStats(db: Db, now = new Date()): Promise<number> {
  const day = istDate(now);
  const allShops = await db.select({ id: shops.id }).from(shops);
  const rows = await footfall(
    db,
    allShops.map((s) => s.id),
    day,
    day,
  );
  for (const r of rows) {
    const values = {
      orders: r.orders,
      completed: r.completed,
      cancelled: r.cancelled,
      salesPaise: r.salesPaise,
    };
    await db
      .insert(dailyShopStats)
      .values({ shopId: r.shopId, day: r.day, ...values })
      .onConflictDoUpdate({ target: [dailyShopStats.shopId, dailyShopStats.day], set: values });
  }
  return rows.length;
}

export type PurgeReport = {
  phase: 'daily' | 'season';
  otpRequests: number;
  rateLimits: number;
  customersAnonymised: number;
  dryRun: boolean;
};

/**
 * G9 data minimisation. Daily: drop OTP and rate-limit rows older than a day.
 * From SEASON_END + 90 days: anonymise customers and withdraw consents. Orders,
 * bills and payment records are financial records and are kept, linked only to
 * the anonymised user id. Staff accounts and daily stats are kept.
 */
export async function purge(db: Db, now = new Date(), dryRun = false): Promise<PurgeReport> {
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const seasonPurgeFrom = addDays(env.seasonEndDate(), 90);
  const seasonOver = istDate(now) >= seasonPurgeFrom;

  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const otpOld = lt(otpRequests.createdAt, dayAgo);
  const rlOld = lt(rateLimits.windowStart, dayAgo);
  const customer = and(eq(users.role, 'customer'), sql`${users.deletedAt} is null`);

  const report: PurgeReport = {
    phase: seasonOver ? 'season' : 'daily',
    otpRequests: await count(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(otpRequests)
        .where(seasonOver ? undefined : otpOld),
    ),
    rateLimits: await count(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(rateLimits)
        .where(rlOld),
    ),
    customersAnonymised: seasonOver
      ? await count(
          db
            .select({ n: sql<number>`count(*)::int` })
            .from(users)
            .where(customer),
        )
      : 0,
    dryRun,
  };
  if (dryRun) return report;

  await db.transaction(async (tx) => {
    await tx.delete(otpRequests).where(seasonOver ? undefined : otpOld);
    await tx.delete(rateLimits).where(rlOld);
    if (seasonOver) {
      const anon = await tx
        .update(users)
        .set({
          phoneE164: sql`'purged:' || ${users.id}`,
          displayName: null,
          deletedAt: now,
          tokenVersion: sql`${users.tokenVersion} + 1`,
        })
        .where(customer)
        .returning({ id: users.id });
      if (anon.length) {
        await tx
          .update(consents)
          .set({ withdrawnAt: now })
          .where(
            and(
              inArray(
                consents.userId,
                anon.map((a) => a.id),
              ),
              sql`${consents.withdrawnAt} is null`,
            ),
          );
      }
    }
    await audit(tx, { actorUserId: null, action: 'job.purge', entity: 'system', meta: report });
  });
  return report;
}
