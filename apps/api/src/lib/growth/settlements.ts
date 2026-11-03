// Settlement of redeemed customer credit to merchants (G3, G13): the platform pays the shop the
// credit its customers used, weekly (Monday, for last Monday–Sunday) or on request once a day.
// Built only from credit_redemptions rows; an admin records the UTR when the transfer is made.
import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { istDate, istDayRange, previousWeek, type Settlement } from '@pataka/shared';
import type { Db } from '../../db/client';
import {
  creditRedemptions,
  merchantPaymentSettings,
  merchantSettlements,
  shopMembers,
  shops,
} from '../../db/schema';
import { audit } from '../audit';
import { HttpError } from '../errors';
import { notify, type Tx } from './common';

async function owed(db: Db | Tx, shopId: string) {
  const [r] = await db
    .select({ s: sql<number>`coalesce(sum(${creditRedemptions.amountPaise}), 0)::int` })
    .from(creditRedemptions)
    .where(
      and(
        eq(creditRedemptions.shopId, shopId),
        eq(creditRedemptions.status, 'redeemed'),
        isNull(creditRedemptions.settlementId),
      ),
    );
  return r?.s ?? 0;
}

async function upiHint(db: Db | Tx, shopId: string) {
  const [s] = await db
    .select({ vpa: merchantPaymentSettings.upiVpa })
    .from(merchantPaymentSettings)
    .where(eq(merchantPaymentSettings.shopId, shopId));
  const v = s?.vpa;
  return v ? `${v.slice(0, 2)}•••@${v.split('@')[1] ?? ''}` : null;
}

/** Puts every unsettled redemption in the range into one settlement. Null when nothing is owed. */
async function settle(
  tx: Tx,
  shopId: string,
  mode: 'weekly' | 'requested',
  range: { from: Date; to: Date } | null,
  period: { start: string; end: string } | null,
) {
  const where = and(
    eq(creditRedemptions.shopId, shopId),
    eq(creditRedemptions.status, 'redeemed'),
    isNull(creditRedemptions.settlementId),
    range ? gte(creditRedemptions.updatedAt, range.from) : undefined,
    range ? lte(creditRedemptions.updatedAt, range.to) : undefined,
  );
  const rows = await tx.select().from(creditRedemptions).where(where).for('update');
  const amount = rows.reduce((s, r) => s + r.amountPaise, 0);
  if (amount <= 0) return null;
  const [row] = await tx
    .insert(merchantSettlements)
    .values({
      shopId,
      mode,
      amountPaise: amount,
      periodStart: period?.start ?? null,
      periodEnd: period?.end ?? null,
      requestedDay: mode === 'requested' ? istDate() : null,
      upiHint: await upiHint(tx, shopId),
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return null;
  await tx
    .update(creditRedemptions)
    .set({ settlementId: row.id })
    .where(
      sql`${creditRedemptions.id} in (${sql.join(
        rows.map((r) => sql`${r.id}`),
        sql`, `,
      )})`,
    );
  return row;
}

/** Monday 03:30 IST: one pending settlement per shop for last week's redemptions; re-runs add nothing. */
export async function weeklySettlements(db: Db, now = new Date()): Promise<number> {
  const week = previousWeek(now);
  const range = { from: istDayRange(week.start).from, to: istDayRange(week.end).to };
  const shopIds = await db
    .selectDistinct({ id: creditRedemptions.shopId })
    .from(creditRedemptions)
    .where(and(eq(creditRedemptions.status, 'redeemed'), isNull(creditRedemptions.settlementId)));
  let n = 0;
  for (const { id } of shopIds) {
    const row = await db.transaction((tx) => settle(tx, id, 'weekly', range, week));
    if (row) n++;
  }
  return n;
}

/** Owner: pay everything owed now, once per calendar day. */
export async function requestSettlement(db: Db, shopId: string, actorId: string) {
  const row = await db.transaction(async (tx) => {
    const [today] = await tx
      .select({ id: merchantSettlements.id })
      .from(merchantSettlements)
      .where(
        and(
          eq(merchantSettlements.shopId, shopId),
          eq(merchantSettlements.mode, 'requested'),
          eq(merchantSettlements.requestedDay, istDate()),
        ),
      );
    if (today)
      throw new HttpError(409, 'settlement_today', 'You can ask once a day; try again tomorrow');
    const r = await settle(tx, shopId, 'requested', null, null);
    if (!r) throw new HttpError(409, 'nothing_owed', 'Nothing is owed to you right now');
    await audit(tx, {
      actorUserId: actorId,
      action: 'settlement.request',
      entity: 'settlement',
      entityId: r.id,
    });
    return r;
  });
  return row;
}

export async function settlementViews(
  db: Db,
  where: { shopId?: string; status?: 'pending' | 'paid' },
) {
  const rows = await db
    .select({ s: merchantSettlements, code: shops.shortCode, name: shops.name })
    .from(merchantSettlements)
    .innerJoin(shops, eq(shops.id, merchantSettlements.shopId))
    .where(
      and(
        where.shopId ? eq(merchantSettlements.shopId, where.shopId) : undefined,
        where.status ? eq(merchantSettlements.status, where.status) : undefined,
      ),
    )
    .orderBy(desc(merchantSettlements.createdAt))
    .limit(200);
  const counts = new Map<string, number>();
  if (rows.length) {
    const c = await db
      .select({ id: creditRedemptions.settlementId, n: sql<number>`count(*)::int` })
      .from(creditRedemptions)
      .where(
        sql`${creditRedemptions.settlementId} in (${sql.join(
          rows.map((r) => sql`${r.s.id}`),
          sql`, `,
        )})`,
      )
      .groupBy(creditRedemptions.settlementId);
    for (const x of c) if (x.id) counts.set(x.id, x.n);
  }
  return rows.map((r): Settlement => ({
    id: r.s.id,
    shopCode: r.code,
    shopName: r.name,
    mode: r.s.mode,
    periodStart: r.s.periodStart,
    periodEnd: r.s.periodEnd,
    amountPaise: r.s.amountPaise,
    status: r.s.status,
    upiHint: r.s.upiHint,
    utr: r.s.utr,
    bills: counts.get(r.s.id) ?? 0,
    createdAt: r.s.createdAt.toISOString(),
    paidAt: r.s.paidAt?.toISOString() ?? null,
  }));
}

export async function shopSettlements(db: Db, shopId: string) {
  const [today] = await db
    .select({ id: merchantSettlements.id })
    .from(merchantSettlements)
    .where(
      and(
        eq(merchantSettlements.shopId, shopId),
        eq(merchantSettlements.mode, 'requested'),
        eq(merchantSettlements.requestedDay, istDate()),
      ),
    );
  const owedPaise = await owed(db, shopId);
  return {
    owedPaise,
    canRequestToday: !today && owedPaise > 0,
    settlements: await settlementViews(db, { shopId }),
  };
}

export async function markSettlementPaid(db: Db, adminId: string, id: string, utr: string) {
  await db.transaction(async (tx) => {
    const [s] = await tx
      .update(merchantSettlements)
      .set({ status: 'paid', utr, paidBy: adminId, paidAt: new Date() })
      .where(and(eq(merchantSettlements.id, id), eq(merchantSettlements.status, 'pending')))
      .returning();
    if (!s) throw new HttpError(409, 'bad_state', 'This settlement is not pending');
    const owners = await tx
      .select({ userId: shopMembers.userId })
      .from(shopMembers)
      .where(and(eq(shopMembers.shopId, s.shopId), eq(shopMembers.role, 'shop_owner')));
    for (const o of owners)
      await notify(tx, o.userId, 'settlement.paid', { amountPaise: s.amountPaise, utr });
    await audit(tx, {
      actorUserId: adminId,
      action: 'settlement.paid',
      entity: 'settlement',
      entityId: id,
      meta: { utr },
    });
  });
}
