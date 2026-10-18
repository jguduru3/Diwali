import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { visitSchema, type Visit } from '@pataka/shared';
import { getDb } from '../src/db/client';
import { slots, users } from '../src/db/schema';
import {
  cancelVisitHandler,
  createVisitHandler,
  currentVisitHandler,
} from '../src/functions/visits';
import { body, call, errorCode, makeListedShop, makeUser } from './helpers';

const book = (session: string, slotId: string, extra: Record<string, unknown> = {}) =>
  call(createVisitHandler, {
    method: 'POST',
    session,
    body: { shopShortCode: 'SLC01', slotId, vehicle: 'car', ...extra },
  });

const slotRow = async (id: string) =>
  (await getDb().select().from(slots).where(eq(slots.id, id)))[0]!;

describe('booking a pickup slot', () => {
  it('returns a ticket with a 6-character code; current visit shows it', async () => {
    const { slot } = await makeListedShop();
    const { session } = await makeUser();
    const res = await book(session, slot.id);
    expect(res.status).toBe(201);
    const visit = visitSchema.parse(res.jsonBody);
    expect(visit.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(visit).toMatchObject({ status: 'booked', vehicle: 'car', shop: { shortCode: 'SLC01' } });
    const current = await call(currentVisitHandler, { session });
    expect(body<{ visit: Visit }>(current).visit.code).toBe(visit.code);
    expect((await slotRow(slot.id)).booked).toBe(1);
  });

  it('needs sign-in', async () => {
    const { slot } = await makeListedShop();
    const res = await call(createVisitHandler, {
      method: 'POST',
      body: { shopShortCode: 'SLC01', slotId: slot.id },
    });
    expect(res.status).toBe(401);
  });

  it('G1: rejects any attempt to send an item list with the booking', async () => {
    const { slot } = await makeListedShop();
    const { session } = await makeUser();
    const res = await book(session, slot.id, { items: [{ itemNo: 1, qty: 2 }] });
    expect(res.status).toBe(400);
    expect((await slotRow(slot.id)).booked).toBe(0);
  });

  it('50 parallel requests on a capacity-10 slot → exactly 10 succeed', async () => {
    const { slot } = await makeListedShop('SLC01', { capacity: 10 });
    const people = await Promise.all(Array.from({ length: 50 }, () => makeUser()));
    const results = await Promise.all(people.map((p) => book(p.session, slot.id)));
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(10);
    expect(results.filter((r) => errorCode(r) === 'slot_full')).toHaveLength(40);
    expect((await slotRow(slot.id)).booked).toBe(10);
  });

  it('allows only one active visit per person', async () => {
    const { slot } = await makeListedShop();
    const { session } = await makeUser();
    expect((await book(session, slot.id)).status).toBe(201);
    const second = await book(session, slot.id);
    expect(second.status).toBe(409);
    expect(errorCode(second)).toBe('active_visit_exists');
  });

  it('rejects slots starting in less than 30 minutes', async () => {
    const { slot } = await makeListedShop('SLC01', { slotStartsInMin: 20 });
    const { session } = await makeUser();
    expect(errorCode(await book(session, slot.id))).toBe('slot_too_soon');
  });

  it('blocked numbers cannot book', async () => {
    const { slot } = await makeListedShop();
    const { session, user } = await makeUser();
    await getDb()
      .update(users)
      .set({ noShowStrikes: 3, blockedUntil: new Date(Date.now() + 86_400_000) })
      .where(eq(users.id, user.id));
    expect(errorCode(await book(session, slot.id))).toBe('blocked');
  });

  it('cancel frees the place and allows booking again', async () => {
    const { slot } = await makeListedShop();
    const { session } = await makeUser();
    const visit = visitSchema.parse((await book(session, slot.id)).jsonBody);
    const res = await call(cancelVisitHandler, {
      method: 'POST',
      session,
      params: { code: visit.code },
    });
    expect(body<Visit>(res).status).toBe('cancelled');
    expect((await slotRow(slot.id)).booked).toBe(0);
    expect((await book(session, slot.id)).status).toBe(201);
  });

  it("cannot cancel someone else's visit", async () => {
    const { slot } = await makeListedShop();
    const a = await makeUser();
    const b = await makeUser();
    const visit = visitSchema.parse((await book(a.session, slot.id)).jsonBody);
    const res = await call(cancelVisitHandler, {
      method: 'POST',
      session: b.session,
      params: { code: visit.code },
    });
    expect(res.status).toBe(404);
  });
});
