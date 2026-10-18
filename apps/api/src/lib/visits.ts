import { randomInt } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import {
  VISIT_CODE_ALPHABET,
  type ClusterInfo,
  type QueueVisit,
  type Vehicle,
  type Visit,
} from '@pataka/shared';
import type { Db } from '../db/client';
import { clusters, shops, slots, users, visits } from '../db/schema';
import { env } from './env';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** No-show strikes before a number is blocked for the rest of the season. */
export const MAX_STRIKES = 3;

export function newVisitCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += VISIT_CODE_ALPHABET[randomInt(VISIT_CODE_ALPHABET.length)];
  return code;
}

export function clusterView(c: typeof clusters.$inferSelect | null): ClusterInfo | null {
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    area: c.area,
    address: c.address,
    lat: c.lat,
    lng: c.lng,
    gateNotes: c.gateNotes,
  };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Visit with its shop, slot and cluster, as the customer ticket needs it. */
export async function loadVisitView(db: Db | Tx, code: string): Promise<Visit | null> {
  const [row] = await db
    .select({ v: visits, s: slots, shop: shops, c: clusters })
    .from(visits)
    .innerJoin(slots, eq(slots.id, visits.slotId))
    .innerJoin(shops, eq(shops.id, visits.shopId))
    .leftJoin(clusters, eq(clusters.id, shops.clusterId))
    .where(eq(visits.code, code));
  if (!row) return null;
  return {
    code: row.v.code,
    status: row.v.status,
    vehicle: (row.v.partyVehicle as Vehicle | null) ?? null,
    bayNo: row.v.bayNo,
    slot: { startsAt: row.s.startsAt.toISOString(), endsAt: row.s.endsAt.toISOString() },
    shop: {
      shortCode: row.shop.shortCode,
      name: row.shop.name,
      address: row.shop.address,
      lat: row.shop.lat,
      lng: row.shop.lng,
    },
    cluster: clusterView(row.c),
    arrivedAt: iso(row.v.arrivedAt),
    servedAt: iso(row.v.servedAt),
    createdAt: row.v.createdAt.toISOString(),
  };
}

export function queueVisitView(row: {
  v: typeof visits.$inferSelect;
  s: typeof slots.$inferSelect;
  shop: Pick<typeof shops.$inferSelect, 'shortCode' | 'name'>;
}): QueueVisit {
  return {
    code: row.v.code,
    status: row.v.status,
    vehicle: (row.v.partyVehicle as Vehicle | null) ?? null,
    bayNo: row.v.bayNo,
    shopCode: row.shop.shortCode,
    shopName: row.shop.name,
    slotStartsAt: row.s.startsAt.toISOString(),
    slotEndsAt: row.s.endsAt.toISOString(),
    arrivedAt: iso(row.v.arrivedAt),
    servedAt: iso(row.v.servedAt),
  };
}

/** One no-show strike; the third blocks booking until the season ends. */
export async function addStrike(db: Db | Tx, userId: string): Promise<void> {
  await db
    .update(users)
    .set({
      noShowStrikes: sql`${users.noShowStrikes} + 1`,
      blockedUntil: sql`case when ${users.noShowStrikes} + 1 >= ${MAX_STRIKES}
        then ${env.seasonEndInstant().toISOString()}::timestamptz else ${users.blockedUntil} end`,
    })
    .where(eq(users.id, userId));
}

/** Frees the slot place held by a visit (cancel / no-show). */
export async function releaseSlot(db: Db | Tx, slotId: string): Promise<void> {
  await db
    .update(slots)
    .set({ booked: sql`greatest(${slots.booked} - 1, 0)` })
    .where(eq(slots.id, slotId));
}
