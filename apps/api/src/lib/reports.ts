import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { istDayRange, type FootfallRow, type Licence } from '@pataka/shared';
import type { Db } from '../db/client';
import { dailyShopStats, shopLicences, slots, visits } from '../db/schema';
import type { ShopRow } from './access';

/** Footfall per shop and day (no money — G4). */

export async function footfall(
  db: Db,
  shopIds: string[],
  from: string,
  to: string,
): Promise<(FootfallRow & { shopId: string; medianArriveToServeMin: number | null })[]> {
  if (!shopIds.length) return [];
  const range = { from: istDayRange(from).from, to: istDayRange(to).to };
  const live = await db
    .select({
      shopId: visits.shopId,
      day: sql<string>`to_char((${slots.startsAt} at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD')`,
      booked: sql<number>`count(*)::int`,
      arrived: sql<number>`count(*) filter (where ${visits.arrivedAt} is not null)::int`,
      served: sql<number>`count(*) filter (where ${visits.status} = 'served')::int`,
      noShow: sql<number>`count(*) filter (where ${visits.status} = 'no_show')::int`,
      cancelled: sql<number>`count(*) filter (where ${visits.status} = 'cancelled')::int`,
      median: sql<
        number | null
      >`percentile_cont(0.5) within group (order by extract(epoch from ${visits.servedAt} - ${visits.arrivedAt}) / 60)
        filter (where ${visits.servedAt} is not null and ${visits.arrivedAt} is not null)`,
    })
    .from(visits)
    .innerJoin(slots, eq(slots.id, visits.slotId))
    .where(
      and(
        inArray(visits.shopId, shopIds),
        gte(slots.startsAt, range.from),
        lt(slots.startsAt, range.to),
      ),
    )
    .groupBy(visits.shopId, sql`2`);
  // Stored rows survive the end-of-season purge; live rows win where both exist.
  const stored = await db
    .select()
    .from(dailyShopStats)
    .where(
      and(
        inArray(dailyShopStats.shopId, shopIds),
        gte(dailyShopStats.day, from),
        sql`${dailyShopStats.day} <= ${to}`,
      ),
    );
  const out = new Map<
    string,
    FootfallRow & { shopId: string; medianArriveToServeMin: number | null }
  >();
  for (const s of stored) {
    out.set(`${s.shopId}:${s.day}`, {
      shopId: s.shopId,
      day: s.day,
      booked: s.booked,
      arrived: s.arrived,
      served: s.served,
      noShow: s.noShow,
      cancelled: s.cancelled,
      medianArriveToServeMin: null,
    });
  }
  for (const l of live) {
    out.set(`${l.shopId}:${l.day}`, {
      shopId: l.shopId,
      day: l.day,
      booked: l.booked,
      arrived: l.arrived,
      served: l.served,
      noShow: l.noShow,
      cancelled: l.cancelled,
      medianArriveToServeMin: l.median == null ? null : Math.round(Number(l.median) * 10) / 10,
    });
  }
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function licenceView(
  l: typeof shopLicences.$inferSelect,
  shop: Pick<ShopRow, 'shortCode' | 'name'>,
): Licence {
  return {
    id: l.id,
    shopCode: shop.shortCode,
    shopName: shop.name,
    licenceNo: l.licenceNo,
    licenceType: l.licenceType,
    issuedBy: l.issuedBy,
    validFrom: l.validFrom,
    validTo: l.validTo,
    status: l.status,
    notes: l.notes,
    verifiedAt: l.verifiedAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
    hasImage: !!l.imageBlobPath,
  };
}
