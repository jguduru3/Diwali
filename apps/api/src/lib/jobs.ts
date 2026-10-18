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
  slots,
  users,
  visibleShops,
  visits,
} from '../db/schema';
import { audit } from './audit';
import { env } from './env';
import { footfall } from './reports';
import { bookableDates, ensureSlots } from './slots';
import { addStrike, releaseSlot } from './visits';

/** Booked visits not checked in by slot end + 15 min become no-shows (strike, place freed). */
export const NO_SHOW_GRACE_MINUTES = 15;

export async function sweepNoShows(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - NO_SHOW_GRACE_MINUTES * 60_000);
  const due = await db
    .select({ id: visits.id, slotId: visits.slotId, userId: visits.userId })
    .from(visits)
    .innerJoin(slots, eq(slots.id, visits.slotId))
    .where(and(eq(visits.status, 'booked'), lt(slots.endsAt, cutoff)));
  for (const v of due) {
    await db.transaction(async (tx) => {
      const [hit] = await tx
        .update(visits)
        .set({ status: 'no_show', noShowAt: now })
        .where(and(eq(visits.id, v.id), eq(visits.status, 'booked')))
        .returning({ id: visits.id });
      if (!hit) return;
      await releaseSlot(tx, v.slotId);
      await addStrike(tx, v.userId);
      await audit(tx, {
        actorUserId: null,
        action: 'job.no_show',
        entity: 'visit',
        entityId: v.id,
      });
    });
  }
  return due.length;
}

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
      booked: r.booked,
      arrived: r.arrived,
      served: r.served,
      noShow: r.noShow,
      cancelled: r.cancelled,
    };
    await db
      .insert(dailyShopStats)
      .values({ shopId: r.shopId, day: r.day, ...values })
      .onConflictDoUpdate({ target: [dailyShopStats.shopId, dailyShopStats.day], set: values });
  }
  return rows.length;
}

/** Keeps slots generated for every listed shop across the booking horizon. */
export async function generateUpcomingSlots(db: Db, now = new Date()): Promise<number> {
  const listed = await db.select().from(visibleShops);
  for (const shop of listed) {
    for (const date of bookableDates(now)) await ensureSlots(db, shop, date);
  }
  return listed.length;
}

export type PurgeReport = {
  phase: 'daily' | 'season';
  otpRequests: number;
  rateLimits: number;
  visits: number;
  customersAnonymised: number;
  dryRun: boolean;
};

/**
 * G9 data minimisation. Daily: drop OTP and rate-limit rows older than a day.
 * From SEASON_END + 90 days: delete all visits, anonymise customers, withdraw consents.
 * Staff accounts and daily stats are kept.
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
    visits: seasonOver ? await count(db.select({ n: sql<number>`count(*)::int` }).from(visits)) : 0,
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
      await tx.delete(visits);
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
