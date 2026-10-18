// Gate app (cluster marshal): scan slot QR → validate → assign holding bay.
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import {
  gateCheckinSchema,
  istDate,
  istDayRange,
  type GateCheckinResult,
  type GateToday,
  type Vehicle,
} from '@pataka/shared';
import { getDb } from '../db/client';
import { shops, slots, visits } from '../db/schema';
import { requireCluster } from '../lib/access';
import { audit } from '../lib/audit';
import { env } from '../lib/env';
import { HttpError } from '../lib/errors';
import { http, json, parseBody } from '../lib/http';
import { clusterView, queueVisitView } from '../lib/visits';

/** Check-in window around the slot: from 30 min before start to 15 min after end. */
export const EARLY_MINUTES = 30;
export const LATE_MINUTES = 15;

/** POST /api/gate/checkin {code, bayNo?} */
export async function gateCheckinHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, cluster } = await requireCluster(db, req);
  const input = await parseBody(req, gateCheckinSchema);

  const result = await db.transaction(async (tx) => {
    // Serialise bay assignment per cluster.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${cluster.id}))`);

    const [row] = await tx
      .select({ v: visits, s: slots, shop: shops })
      .from(visits)
      .innerJoin(slots, eq(slots.id, visits.slotId))
      .innerJoin(shops, eq(shops.id, visits.shopId))
      .where(eq(visits.code, input.code));
    if (!row) throw new HttpError(404, 'visit_not_found', 'No ticket with this code');
    if (row.shop.clusterId !== cluster.id) {
      throw new HttpError(
        409,
        'wrong_cluster',
        `This ticket is for ${row.shop.name}, at another ground`,
      );
    }
    switch (row.v.status) {
      case 'arrived':
        throw new HttpError(409, 'already_checked_in', `Already checked in — bay ${row.v.bayNo}`);
      case 'served':
        throw new HttpError(409, 'already_used', 'This ticket has already been used');
      case 'cancelled':
        throw new HttpError(409, 'cancelled', 'This ticket was cancelled');
      case 'no_show':
        throw new HttpError(409, 'expired', 'This ticket expired (no-show)');
    }

    const now = Date.now();
    const opens = row.s.startsAt.getTime() - EARLY_MINUTES * 60_000;
    const closes = row.s.endsAt.getTime() + LATE_MINUTES * 60_000;
    // Demo mode skips the time window so the whole flow can be tried at any hour.
    if (!env.demoMode()) {
      if (now < opens) throw new HttpError(409, 'too_early', 'Too early for this slot');
      if (now > closes) throw new HttpError(409, 'too_late', 'This slot has ended');
    }

    const used = await tx
      .select({ bayNo: visits.bayNo })
      .from(visits)
      .innerJoin(shops, eq(shops.id, visits.shopId))
      .where(and(eq(shops.clusterId, cluster.id), eq(visits.status, 'arrived')));
    const taken = new Set(used.map((u) => u.bayNo));
    let bayNo = input.bayNo;
    if (bayNo !== undefined) {
      if (bayNo > cluster.bayCount) throw new HttpError(400, 'bad_bay', 'No such bay');
      if (taken.has(bayNo)) throw new HttpError(409, 'bay_taken', `Bay ${bayNo} is in use`);
    } else {
      bayNo = Array.from({ length: cluster.bayCount }, (_, i) => i + 1).find((b) => !taken.has(b));
      if (!bayNo) throw new HttpError(409, 'bays_full', 'All bays are full. Ask the car to wait.');
    }

    const [updated] = await tx
      .update(visits)
      .set({ status: 'arrived', arrivedAt: sql`now()`, bayNo })
      .where(and(eq(visits.id, row.v.id), eq(visits.status, 'booked')))
      .returning({ id: visits.id });
    if (!updated) throw new HttpError(409, 'already_checked_in', 'Already checked in');
    await audit(tx, {
      actorUserId: user.id,
      action: 'gate.checkin',
      entity: 'visit',
      entityId: row.v.id,
      meta: { bayNo, clusterId: cluster.id },
    });
    const body: GateCheckinResult = {
      code: row.v.code,
      bayNo,
      shop: { shortCode: row.shop.shortCode, name: row.shop.name },
      slot: { startsAt: row.s.startsAt.toISOString(), endsAt: row.s.endsAt.toISOString() },
      vehicle: (row.v.partyVehicle as Vehicle | null) ?? null,
    };
    return body;
  });
  return json(result);
}

/** GET /api/gate/today — today's tickets for the cluster and bay occupancy. */
export async function gateTodayHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { cluster } = await requireCluster(db, req);
  const { from, to } = istDayRange(istDate());
  const rows = await db
    .select({ v: visits, s: slots, shop: shops })
    .from(visits)
    .innerJoin(slots, eq(slots.id, visits.slotId))
    .innerJoin(shops, eq(shops.id, visits.shopId))
    .where(and(eq(shops.clusterId, cluster.id), gte(slots.startsAt, from), lt(slots.startsAt, to)))
    .orderBy(asc(slots.startsAt), asc(visits.createdAt));
  const arrived = await db
    .select({ bayNo: visits.bayNo, code: visits.code, shopName: shops.name })
    .from(visits)
    .innerJoin(shops, eq(shops.id, visits.shopId))
    .where(and(eq(shops.clusterId, cluster.id), eq(visits.status, 'arrived')))
    .orderBy(asc(visits.bayNo));
  const body: GateToday = {
    cluster: { ...clusterView(cluster)!, bayCount: cluster.bayCount },
    baysInUse: arrived.map((a) => ({ bayNo: a.bayNo ?? 0, code: a.code, shopName: a.shopName })),
    visits: rows.map(queueVisitView),
  };
  return json(body);
}

http('gateCheckin', ['POST'], 'gate/checkin', gateCheckinHandler);
http('gateToday', ['GET'], 'gate/today', gateTodayHandler);
