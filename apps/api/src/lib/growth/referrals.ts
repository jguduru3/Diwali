// Referrals (G12) and customer credit (G11). A referral pays ₹10 once, when the referred
// person's first order has its ₹30 fee captured and is packed (pickup QR issued); a later fee
// refund reverses it. Credit is a discount at a listed shop's counter, held when the counter
// takes payment and redeemed with the bill, all inside the payment transaction.
import { and, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { maxRedeemable, REFERRAL_REWARD_PAISE, type CreditView } from '@pataka/shared';
import type { Db } from '../../db/client';
import {
  creditLedger,
  creditRedemptions,
  feePayments,
  influencers,
  orders,
  referrals,
  users,
} from '../../db/schema';
import { audit } from '../audit';
import { HttpError } from '../errors';
import {
  creditBalance,
  creditEntry,
  creditExpiresOn,
  lockUser,
  type DbOrTx,
  type Tx,
  uniqueCode,
  walletEntry,
  walletOf,
} from './common';

type OrderRow = typeof orders.$inferSelect;

/** The person's own DXR- code, created on first use. */
export async function ensureReferralCode(db: Db, userId: string): Promise<string> {
  const [u] = await db.select({ code: users.referralCode }).from(users).where(eq(users.id, userId));
  if (u?.code) return u.code;
  const code = await uniqueCode(db, 'DXR', async (c) => {
    const [hit] = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, c));
    return !!hit;
  });
  const [set] = await db
    .update(users)
    .set({ referralCode: code })
    .where(and(eq(users.id, userId), sql`${users.referralCode} is null`))
    .returning({ code: users.referralCode });
  if (set?.code) return set.code;
  const [again] = await db
    .select({ code: users.referralCode })
    .from(users)
    .where(eq(users.id, userId));
  return again!.code!;
}

/**
 * Records who referred this person (a customer's DXR- code or an influencer's DXI- code).
 * Only before their first order, once, never themselves. Referral codes never gate access.
 */
export async function claimReferral(db: Db, userId: string, code: string) {
  return db.transaction(async (tx) => {
    let referrer: string | null = null;
    let source: 'customer' | 'influencer';
    if (code.startsWith('DXR-')) {
      const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.referralCode, code));
      referrer = u?.id ?? null;
      source = 'customer';
    } else if (code.startsWith('DXI-')) {
      const [i] = await tx
        .select({ userId: influencers.userId })
        .from(influencers)
        .where(and(eq(influencers.code, code), eq(influencers.status, 'active')));
      referrer = i?.userId ?? null;
      source = 'influencer';
    } else {
      throw new HttpError(400, 'invalid_code', 'Not a referral code');
    }
    if (!referrer) throw new HttpError(404, 'code_not_found', 'That code was not found');
    if (referrer === userId) throw new HttpError(409, 'own_code', 'You cannot use your own code');
    const [ordered] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.userId, userId), ne(orders.status, 'fee_pending')))
      .limit(1);
    if (ordered) {
      throw new HttpError(409, 'already_ordered', 'Codes work only before your first order');
    }
    const [row] = await tx
      .insert(referrals)
      .values({ referrerUserId: referrer, refereeUserId: userId, source, code })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new HttpError(409, 'already_referred', 'You already used a referral code');
    await audit(tx, {
      actorUserId: userId,
      action: 'referral.claim',
      entity: 'referral',
      entityId: row.id,
      meta: { source },
    });
    return { source };
  });
}

/**
 * Called inside the `packed` transition. If this is the referee's first packed order and its
 * ₹30 fee was captured, the referrer gets ₹10 — in the same transaction, so a rolled-back
 * packing never pays (G12).
 */
export async function qualifyReferralOnPacked(tx: Tx, order: OrderRow) {
  const [ref] = await tx
    .select()
    .from(referrals)
    .where(and(eq(referrals.refereeUserId, order.userId), eq(referrals.status, 'pending')))
    .for('update');
  if (!ref) return;
  const [feePaid] = await tx
    .select({ id: feePayments.id })
    .from(feePayments)
    .where(and(eq(feePayments.orderId, order.id), eq(feePayments.status, 'captured')))
    .limit(1);
  if (!feePaid) return;
  const [earlier] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(eq(orders.userId, order.userId), ne(orders.id, order.id), isNotNull(orders.packedAt)),
    )
    .limit(1);
  if (earlier) {
    await tx.update(referrals).set({ status: 'rejected' }).where(eq(referrals.id, ref.id));
    return;
  }
  if (ref.source === 'customer') {
    await creditEntry(tx, ref.referrerUserId, 'referral', ref.id, REFERRAL_REWARD_PAISE);
  } else {
    const wallet = await walletOf(tx, ref.referrerUserId);
    if (!wallet) return; // an influencer always has a wallet; nothing to pay into otherwise
    await walletEntry(tx, wallet.id, 'referral_reward', ref.id, REFERRAL_REWARD_PAISE);
  }
  await tx
    .update(referrals)
    .set({ status: 'rewarded', qualifyingOrderId: order.id, rewardedAt: new Date() })
    .where(eq(referrals.id, ref.id));
  await audit(tx, {
    actorUserId: null,
    action: 'referral.rewarded',
    entity: 'referral',
    entityId: ref.id,
    meta: { orderId: order.id, source: ref.source },
  });
}

/** The ₹30 fee of the qualifying order was refunded: take the ₹10 back, exactly once. */
export async function reverseReferralForOrder(tx: Tx, orderId: string) {
  const [ref] = await tx
    .select()
    .from(referrals)
    .where(and(eq(referrals.qualifyingOrderId, orderId), eq(referrals.status, 'rewarded')))
    .for('update');
  if (!ref) return;
  if (ref.source === 'customer') {
    await creditEntry(tx, ref.referrerUserId, 'reversal', ref.id, -REFERRAL_REWARD_PAISE);
  } else {
    const wallet = await walletOf(tx, ref.referrerUserId);
    if (wallet)
      await walletEntry(tx, wallet.id, 'reversal', `referral:${ref.id}`, -REFERRAL_REWARD_PAISE);
  }
  await tx.update(referrals).set({ status: 'reversed' }).where(eq(referrals.id, ref.id));
}

export async function creditView(db: Db, userId: string): Promise<CreditView> {
  const referralCode = await ensureReferralCode(db, userId);
  const [stats] = await db
    .select({
      invited: sql<number>`count(*)::int`,
      rewarded: sql<number>`count(*) filter (where ${referrals.status} = 'rewarded')::int`,
    })
    .from(referrals)
    .where(eq(referrals.referrerUserId, userId));
  const history = await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId))
    .orderBy(desc(creditLedger.createdAt))
    .limit(50);
  return {
    balancePaise: await creditBalance(db, userId),
    expiresOn: creditExpiresOn(),
    referralCode,
    invited: stats?.invited ?? 0,
    rewarded: stats?.rewarded ?? 0,
    history: history.map((h) => ({
      id: h.id,
      deltaPaise: h.deltaPaise,
      reason: h.reason,
      at: h.createdAt.toISOString(),
    })),
  };
}

/** The customer asks to use credit on an open order; capped by the server at the counter. */
export async function requestOrderCredit(
  db: Db,
  userId: string,
  orderId: string,
  amountPaise: number,
) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)));
  if (!order) throw new HttpError(404, 'order_not_found', 'No such order');
  if (!['placed', 'confirmed', 'packing', 'awaiting_customer', 'packed'].includes(order.status)) {
    throw new HttpError(409, 'bad_state', 'Credit can be added only before pickup');
  }
  const [held] = await db
    .select({ id: creditRedemptions.id })
    .from(creditRedemptions)
    .where(eq(creditRedemptions.orderId, orderId));
  if (held) throw new HttpError(409, 'credit_locked', 'The counter has already applied credit');
  const balance = await creditBalance(db, userId);
  const amount = Math.min(amountPaise, balance);
  await db.update(orders).set({ creditRequestedPaise: amount }).where(eq(orders.id, orderId));
  return amount;
}

/**
 * Counter: credit to take off this bill. Holds it once per order with the customer's balance
 * locked, so two counters can never spend the same credit (G11). Returns the credit applied.
 */
export async function holdCredit(tx: Tx, order: OrderRow): Promise<number> {
  const [existing] = await tx
    .select()
    .from(creditRedemptions)
    .where(eq(creditRedemptions.orderId, order.id))
    .for('update');
  if (existing) return existing.status === 'released' ? 0 : existing.amountPaise;
  if (!order.creditRequestedPaise) return 0;
  await lockUser(tx, order.userId);
  const amount = maxRedeemable(
    Math.min(order.creditRequestedPaise, order.finalTotalPaise ?? 0),
    await creditBalance(tx, order.userId),
  );
  if (amount <= 0) return 0;
  const [r] = await tx
    .insert(creditRedemptions)
    .values({ orderId: order.id, shopId: order.shopId, userId: order.userId, amountPaise: amount })
    .returning();
  await creditEntry(tx, order.userId, 'hold', r!.id, -amount);
  return amount;
}

/** The bill was issued: the held credit is spent and becomes owed to the merchant. */
export async function redeemHeldCredit(tx: Tx, orderId: string) {
  await tx
    .update(creditRedemptions)
    .set({ status: 'redeemed' })
    .where(and(eq(creditRedemptions.orderId, orderId), eq(creditRedemptions.status, 'held')));
}

/** The order closed without a bill: give held credit back. */
export async function releaseHeldCredit(tx: Tx, orderId: string) {
  const [r] = await tx
    .update(creditRedemptions)
    .set({ status: 'released' })
    .where(and(eq(creditRedemptions.orderId, orderId), eq(creditRedemptions.status, 'held')))
    .returning();
  if (r) await creditEntry(tx, r.userId, 'release', r.id, r.amountPaise);
}

/** What the cashier will take off: the held amount, or what would be held now. */
export async function creditPreview(db: DbOrTx, order: OrderRow): Promise<number> {
  const held = await creditOnBill(db, order.id);
  if (held || !order.creditRequestedPaise || order.finalTotalPaise == null) return held;
  return maxRedeemable(
    Math.min(order.creditRequestedPaise, order.finalTotalPaise),
    await creditBalance(db, order.userId),
  );
}

export async function creditOnBill(db: DbOrTx, orderId: string): Promise<number> {
  const [r] = await db
    .select({ amount: creditRedemptions.amountPaise })
    .from(creditRedemptions)
    .where(and(eq(creditRedemptions.orderId, orderId), ne(creditRedemptions.status, 'released')));
  return r?.amount ?? 0;
}
