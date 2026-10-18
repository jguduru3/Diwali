import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { istDayRange, type FootfallRow, type Licence } from '@pataka/shared';
import type { Db } from '../db/client';
import { dailyShopStats, passScans, shopLicences } from '../db/schema';
import type { ShopRow } from './access';

/** Valid pass checks per shop and day (footfall only, no money — G4). */
export async function footfall(
  db: Db,
  shopIds: string[],
  from: string,
  to: string,
): Promise<(FootfallRow & { shopId: string })[]> {
  if (!shopIds.length) return [];
  const range = { from: istDayRange(from).from, to: istDayRange(to).to };
  const live = await db
    .select({
      shopId: sql<string>`${passScans.shopId}`,
      day: sql<string>`to_char((${passScans.at} at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD')`,
      scans: sql<number>`count(*)::int`,
      uniquePasses: sql<number>`count(distinct ${passScans.passId})::int`,
      flagged: sql<number>`count(*) filter (where ${passScans.flag} is not null)::int`,
    })
    .from(passScans)
    .where(
      and(
        isNotNull(passScans.shopId),
        inArray(passScans.shopId, shopIds),
        eq(passScans.result, 'valid'),
        gte(passScans.at, range.from),
        lt(passScans.at, range.to),
      ),
    )
    .groupBy(passScans.shopId, sql`2`);
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
  const out = new Map<string, FootfallRow & { shopId: string }>();
  for (const s of stored) {
    out.set(`${s.shopId}:${s.day}`, {
      shopId: s.shopId,
      day: s.day,
      scans: s.scans,
      uniquePasses: s.uniquePasses,
      flagged: s.flagged,
    });
  }
  for (const l of live) out.set(`${l.shopId}:${l.day}`, l);
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
