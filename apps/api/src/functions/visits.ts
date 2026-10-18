// Customer pickup slots. A visit is a queue token: the body has no items field
// and extra keys are rejected (G1). Amounts are never recorded (G4).
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { createVisitSchema, visitCodeSchema } from '@pataka/shared';
import { getDb } from '../db/client';
import { slots, visibleShops, visits } from '../db/schema';
import { audit } from '../lib/audit';
import { requireUser } from '../lib/auth';
import { HttpError } from '../lib/errors';
import { http, json, parseBody, pgError } from '../lib/http';
import { BOOKING_LEAD_MINUTES } from '../lib/slots';
import { loadVisitView, newVisitCode, releaseSlot } from '../lib/visits';

/** POST /api/visits — atomic: capacity check + insert in one transaction (SPEC §6.3). */
export async function createVisitHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await requireUser(db, req);
  const input = await parseBody(req, createVisitSchema);
  if (user.blockedUntil && user.blockedUntil > new Date()) {
    throw new HttpError(
      403,
      'blocked',
      'This number missed too many slots and cannot book again this season',
    );
  }

  const [shop] = await db
    .select({ id: visibleShops.id })
    .from(visibleShops)
    .where(eq(visibleShops.shortCode, input.shopShortCode));
  if (!shop) throw new HttpError(404, 'shop_not_found', 'This shop is not listed');

  const [active] = await db
    .select({ code: visits.code })
    .from(visits)
    .where(and(eq(visits.userId, user.id), inArray(visits.status, ['booked', 'arrived'])));
  if (active) {
    throw new HttpError(409, 'active_visit_exists', 'You already have an active pickup slot');
  }

  for (let attempt = 0; ; attempt++) {
    const code = newVisitCode();
    try {
      await db.transaction(async (tx) => {
        const [held] = await tx
          .update(slots)
          .set({ booked: sql`${slots.booked} + 1` })
          .where(
            and(
              eq(slots.id, input.slotId),
              eq(slots.shopId, shop.id),
              sql`${slots.booked} < ${slots.capacity}`,
              gt(slots.startsAt, sql`now() + make_interval(mins => ${BOOKING_LEAD_MINUTES})`),
            ),
          )
          .returning({ id: slots.id });
        if (!held) {
          const [slot] = await tx.select().from(slots).where(eq(slots.id, input.slotId));
          if (!slot || slot.shopId !== shop.id) {
            throw new HttpError(404, 'slot_not_found', 'That slot does not exist');
          }
          if (slot.booked >= slot.capacity) {
            throw new HttpError(409, 'slot_full', 'That slot is full. Please pick another.');
          }
          throw new HttpError(
            409,
            'slot_too_soon',
            'Slots must be booked at least 30 minutes ahead',
          );
        }
        await tx.insert(visits).values({
          code,
          userId: user.id,
          shopId: shop.id,
          slotId: input.slotId,
          partyVehicle: input.vehicle ?? null,
        });
        await audit(tx, {
          actorUserId: user.id,
          action: 'visit.book',
          entity: 'visit',
          meta: { code, slotId: input.slotId },
        });
      });
      return json(await loadVisitView(db, code), 201);
    } catch (err) {
      const e = pgError(err);
      // Visit code collision: try a new code (1 in ~10^9).
      if (e?.code === '23505' && e.constraint === 'visits_code_unique' && attempt < 3) continue;
      throw err;
    }
  }
}

/** GET /api/visits/current — the active visit (booked or arrived), or null. */
export async function currentVisitHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await requireUser(db, req);
  const [active] = await db
    .select({ code: visits.code })
    .from(visits)
    .where(and(eq(visits.userId, user.id), inArray(visits.status, ['booked', 'arrived'])));
  return json({ visit: active ? await loadVisitView(db, active.code) : null });
}

/** POST /api/visits/{code}/cancel — until the slot starts; frees the place. */
export async function cancelVisitHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await requireUser(db, req);
  const code = visitCodeSchema.parse(req.params.code);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ v: visits, s: slots })
      .from(visits)
      .innerJoin(slots, eq(slots.id, visits.slotId))
      .where(and(eq(visits.code, code), eq(visits.userId, user.id)))
      .for('update');
    if (!row) throw new HttpError(404, 'visit_not_found', 'No such visit');
    if (row.v.status !== 'booked') {
      throw new HttpError(409, 'not_cancellable', 'This visit can no longer be cancelled');
    }
    if (row.s.startsAt <= new Date()) {
      throw new HttpError(409, 'slot_started', 'The slot has already started');
    }
    await tx
      .update(visits)
      .set({ status: 'cancelled', cancelledAt: sql`now()` })
      .where(eq(visits.id, row.v.id));
    await releaseSlot(tx, row.v.slotId);
    await audit(tx, {
      actorUserId: user.id,
      action: 'visit.cancel',
      entity: 'visit',
      entityId: row.v.id,
    });
  });
  return json(await loadVisitView(db, code));
}

http('visitsCreate', ['POST'], 'visits', createVisitHandler);
http('visitsCurrent', ['GET'], 'visits/current', currentVisitHandler);
http('visitsCancel', ['POST'], 'visits/{code}/cancel', cancelVisitHandler);
