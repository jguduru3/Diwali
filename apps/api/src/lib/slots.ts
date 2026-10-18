import { and, asc, eq, gte, lt, notInArray, sql } from 'drizzle-orm';
import { addDays, istDate, istDayRange, slotWindows, type Slot } from '@pataka/shared';
import type { Db } from '../db/client';
import { shops, slots } from '../db/schema';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | Tx;

/** How far ahead customers can book. */
export const BOOKING_HORIZON_DAYS = 14;
/** Slots must start at least this long after booking (SPEC §6.3). */
export const BOOKING_LEAD_MINUTES = 30;

type ShopHours = Pick<
  typeof shops.$inferSelect,
  'id' | 'openFrom' | 'openTo' | 'slotMinutes' | 'defaultCapacityPerSlot'
>;
export type SlotRow = typeof slots.$inferSelect;

export function bookableDates(now = new Date()): string[] {
  const today = istDate(now);
  return Array.from({ length: BOOKING_HORIZON_DAYS + 1 }, (_, i) => addDays(today, i));
}

export function slotView(row: SlotRow, now = new Date()): Slot {
  const remaining = Math.max(0, row.capacity - row.booked);
  return {
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    capacity: row.capacity,
    booked: row.booked,
    remaining,
    bookable:
      remaining > 0 && row.startsAt.getTime() > now.getTime() + BOOKING_LEAD_MINUTES * 60_000,
  };
}

/**
 * Creates a day's slots from the shop's default hours, but only if the day has
 * none yet — a day the owner has already shaped is never touched.
 */
export async function ensureSlots(db: DbOrTx, shop: ShopHours, date: string): Promise<void> {
  if (!shop.openFrom || !shop.openTo) return;
  if (!bookableDates().includes(date)) return;
  const { from, to } = istDayRange(date);
  const [existing] = await db
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.shopId, shop.id), gte(slots.startsAt, from), lt(slots.startsAt, to)))
    .limit(1);
  if (existing) return;
  const windows = slotWindows(date, shop.openFrom, shop.openTo, shop.slotMinutes);
  if (!windows.length) return;
  await db
    .insert(slots)
    .values(
      windows.map((w) => ({
        shopId: shop.id,
        startsAt: w.startsAt,
        endsAt: w.endsAt,
        capacity: shop.defaultCapacityPerSlot,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Sets a day's hours and per-slot capacity. Booked slots are never dropped and
 * their capacity never goes below what is already booked (SPEC §8 /shop/slots).
 */
export async function applyDaySlots(
  db: DbOrTx,
  shop: Pick<ShopHours, 'id' | 'slotMinutes'>,
  date: string,
  openFrom: string,
  openTo: string,
  capacity: number,
): Promise<void> {
  const windows = slotWindows(date, openFrom, openTo, shop.slotMinutes);
  const { from, to } = istDayRange(date);
  for (const w of windows) {
    await db
      .insert(slots)
      .values({ shopId: shop.id, startsAt: w.startsAt, endsAt: w.endsAt, capacity })
      .onConflictDoUpdate({
        target: [slots.shopId, slots.startsAt],
        set: { capacity: sql`greatest(${capacity}, ${slots.booked})`, endsAt: w.endsAt },
      });
  }
  const keep = windows.map((w) => w.startsAt);
  await db
    .delete(slots)
    .where(
      and(
        eq(slots.shopId, shop.id),
        gte(slots.startsAt, from),
        lt(slots.startsAt, to),
        eq(slots.booked, 0),
        sql`not exists (select 1 from visits v where v.slot_id = ${slots.id})`,
        ...(keep.length ? [notInArray(slots.startsAt, keep)] : []),
      ),
    );
}

export async function daySlots(db: DbOrTx, shopId: string, date: string): Promise<SlotRow[]> {
  const { from, to } = istDayRange(date);
  return db
    .select()
    .from(slots)
    .where(and(eq(slots.shopId, shopId), gte(slots.startsAt, from), lt(slots.startsAt, to)))
    .orderBy(asc(slots.startsAt));
}
