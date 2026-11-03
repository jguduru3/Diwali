// Agent and influencer wallets: daily withdrawals to the verified UPI ID, ₹2,000 a day in total,
// PAN from ₹18,000 earned in the year, 2% TDS above ₹20,000 (G9, G13).
// Payouts go out through the platform's payout account: an admin sends the transfer from the
// bank / payout portal and records its UTR (provider "manual"); a failed transfer is returned
// to the wallet once, and three failures freeze the wallet for review.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  DAILY_WITHDRAWAL_CAP_PAISE,
  financialYear,
  istDate,
  MAX_FAILED_TRANSFERS,
  PAN_PROMPT_PAISE,
  TDS_THRESHOLD_PAISE,
  tdsFor,
  withdrawalCheck,
  type InfluencerRegister,
  type WalletView,
} from '@pataka/shared';
import type { Db } from '../../db/client';
import {
  agents,
  influencers,
  referrals,
  termsAcceptances,
  users,
  walletLedger,
  wallets,
  withdrawals,
} from '../../db/schema';
import { audit } from '../audit';
import type { SessionUser } from '../auth';
import { HttpError } from '../errors';
import {
  ensureWallet,
  fyEarned,
  maskPhone,
  notify,
  protectPan,
  type Tx,
  uniqueCode,
  walletBalance,
  walletEntry,
  walletOf,
} from './common';
import { TERMS_VERSIONS } from '@pataka/shared';

async function todayOut(db: Db | Tx, walletId: string, day = istDate()) {
  const [r] = await db
    .select({ s: sql<number>`coalesce(sum(${withdrawals.amountPaise}), 0)::int` })
    .from(withdrawals)
    .where(
      and(
        eq(withdrawals.walletId, walletId),
        eq(withdrawals.dayIst, day),
        inArray(withdrawals.status, ['requested', 'sent']),
      ),
    );
  return r?.s ?? 0;
}

export async function walletView(db: Db, userId: string): Promise<WalletView> {
  const w = await walletOf(db, userId);
  if (!w) throw new HttpError(404, 'no_wallet', 'You have no wallet yet');
  const fy = financialYear();
  const earned = await fyEarned(db, w.id, fy);
  const ledger = await db
    .select()
    .from(walletLedger)
    .where(eq(walletLedger.walletId, w.id))
    .orderBy(desc(walletLedger.createdAt))
    .limit(50);
  const outs = await db
    .select()
    .from(withdrawals)
    .where(eq(withdrawals.walletId, w.id))
    .orderBy(desc(withdrawals.createdAt))
    .limit(20);
  return {
    balancePaise: await walletBalance(db, w.id),
    todayRemainingPaise: Math.max(0, DAILY_WITHDRAWAL_CAP_PAISE - (await todayOut(db, w.id))),
    fyEarnedPaise: earned,
    fy,
    panOnFile: !!w.panEnc,
    panRequired: !w.panEnc && earned >= TDS_THRESHOLD_PAISE,
    panPrompt: !w.panEnc && earned >= PAN_PROMPT_PAISE,
    frozen: w.frozen,
    upiHint: w.upiHint,
    ledger: ledger.map((l) => ({
      id: l.id,
      deltaPaise: l.deltaPaise,
      reason: l.reason,
      at: l.createdAt.toISOString(),
    })),
    withdrawals: outs.map((o) => ({
      id: o.id,
      amountPaise: o.amountPaise,
      tdsPaise: o.tdsPaise,
      status: o.status,
      utr: o.utr,
      at: o.createdAt.toISOString(),
    })),
  };
}

export async function setPan(db: Db, userId: string, pan: string) {
  const w = await walletOf(db, userId);
  if (!w) throw new HttpError(404, 'no_wallet', 'You have no wallet yet');
  await db.update(wallets).set(protectPan(pan)).where(eq(wallets.id, w.id));
  await audit(db, {
    actorUserId: userId,
    action: 'wallet.pan_set',
    entity: 'wallet',
    entityId: w.id,
  });
  return walletView(db, userId);
}

/**
 * Takes money out of the wallet into a transfer request, with the wallet row locked so two
 * withdrawals at once cannot pass the daily cap together. Idempotent per key.
 */
export async function withdraw(
  db: Db,
  userId: string,
  amountPaise: number,
  idempotencyKey: string,
) {
  await db.transaction(async (tx) => {
    const [w] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).for('update');
    if (!w) throw new HttpError(404, 'no_wallet', 'You have no wallet yet');
    const [done] = await tx
      .select({ id: withdrawals.id })
      .from(withdrawals)
      .where(eq(withdrawals.idempotencyKey, `${w.id}:${idempotencyKey}`));
    if (done) return;
    const fy = financialYear();
    const earned = await fyEarned(tx, w.id, fy);
    const check = withdrawalCheck({
      balancePaise: await walletBalance(tx, w.id),
      amountPaise,
      todayPaise: await todayOut(tx, w.id),
      fyEarnedPaise: earned,
      hasPan: !!w.panEnc,
      frozen: w.frozen,
    });
    if (!check.ok) {
      const messages: Record<string, string> = {
        amount: 'Enter an amount',
        balance: 'That is more than your balance',
        daily_cap: 'Withdrawals are up to ₹2,000 a day in total',
        frozen: 'Withdrawals are paused while your wallet is reviewed',
        pan_required: 'Add your PAN to keep withdrawing this year',
      };
      throw new HttpError(409, `withdraw_${check.code}`, messages[check.code]!);
    }
    const [{ taxed }] = (await tx
      .select({ taxed: sql<number>`coalesce(sum(${withdrawals.tdsBasePaise}), 0)::int` })
      .from(withdrawals)
      .where(
        and(
          eq(withdrawals.walletId, w.id),
          eq(withdrawals.fy, fy),
          inArray(withdrawals.status, ['requested', 'sent']),
        ),
      )) as [{ taxed: number }];
    const tds = tdsFor({ fyEarnedPaise: earned, taxedBasePaise: taxed, amountPaise });
    const [row] = await tx
      .insert(withdrawals)
      .values({
        walletId: w.id,
        amountPaise,
        tdsPaise: tds.tdsPaise,
        tdsBasePaise: tds.basePaise,
        fy,
        provider: 'manual',
        dayIst: istDate(),
        idempotencyKey: `${w.id}:${idempotencyKey}`,
      })
      .returning();
    await walletEntry(tx, w.id, 'withdrawal', row!.id, -amountPaise);
    await audit(tx, {
      actorUserId: userId,
      action: 'wallet.withdraw',
      entity: 'withdrawal',
      entityId: row!.id,
      meta: { amountPaise, tdsPaise: tds.tdsPaise },
    });
  });
  return walletView(db, userId);
}

/** Admin: the transfer went out (UTR recorded). */
export async function markWithdrawalSent(db: Db, adminId: string, id: string, utr: string) {
  await db.transaction(async (tx) => {
    const [w] = await tx
      .update(withdrawals)
      .set({ status: 'sent', utr, sentAt: new Date(), decidedBy: adminId })
      .where(and(eq(withdrawals.id, id), eq(withdrawals.status, 'requested')))
      .returning();
    if (!w) throw new HttpError(409, 'bad_state', 'This withdrawal is not waiting');
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.id, w.walletId));
    await notify(tx, wallet!.userId, 'wallet.sent', {
      amountPaise: w.amountPaise - w.tdsPaise,
      utr,
    });
    await audit(tx, {
      actorUserId: adminId,
      action: 'withdrawal.sent',
      entity: 'withdrawal',
      entityId: id,
      meta: { utr },
    });
  });
}

/** Admin: the transfer failed; the amount returns to the wallet once; 3 failures freeze it. */
export async function markWithdrawalFailed(db: Db, adminId: string, id: string, reason: string) {
  await db.transaction(async (tx) => {
    const [w] = await tx
      .update(withdrawals)
      .set({ status: 'failed', failureReason: reason, decidedBy: adminId })
      .where(and(eq(withdrawals.id, id), eq(withdrawals.status, 'requested')))
      .returning();
    if (!w) throw new HttpError(409, 'bad_state', 'This withdrawal is not waiting');
    await walletEntry(tx, w.walletId, 'return', w.id, w.amountPaise);
    const [wallet] = await tx
      .update(wallets)
      .set({
        failedTransfers: sql`${wallets.failedTransfers} + 1`,
        frozen: sql`${wallets.failedTransfers} + 1 >= ${MAX_FAILED_TRANSFERS} or ${wallets.frozen}`,
      })
      .where(eq(wallets.id, w.walletId))
      .returning();
    await notify(tx, wallet!.userId, 'wallet.failed', { amountPaise: w.amountPaise });
    await audit(tx, {
      actorUserId: adminId,
      action: 'withdrawal.failed',
      entity: 'withdrawal',
      entityId: id,
      meta: { reason },
    });
  });
}

export async function setFrozen(
  db: Db,
  adminId: string,
  walletId: string,
  frozen: boolean,
  reason?: string,
) {
  const [w] = await db
    .update(wallets)
    .set({
      frozen,
      frozenReason: frozen ? (reason ?? null) : null,
      ...(frozen ? {} : { failedTransfers: 0 }),
    })
    .where(eq(wallets.id, walletId))
    .returning();
  if (!w) throw new HttpError(404, 'no_wallet', 'No such wallet');
  await audit(db, {
    actorUserId: adminId,
    action: frozen ? 'wallet.freeze' : 'wallet.unfreeze',
    entity: 'wallet',
    entityId: walletId,
    meta: { reason },
  });
}

/** Admin list of transfers to make, with the UPI hint (full UPI ID stays encrypted). */
export async function adminWithdrawals(db: Db, status: 'requested' | 'sent' | 'failed' | null) {
  const rows = await db
    .select({ w: withdrawals, wallet: wallets, phone: users.phoneE164, name: users.displayName })
    .from(withdrawals)
    .innerJoin(wallets, eq(wallets.id, withdrawals.walletId))
    .innerJoin(users, eq(users.id, wallets.userId))
    .where(status ? eq(withdrawals.status, status) : undefined)
    .orderBy(desc(withdrawals.createdAt))
    .limit(500);
  return rows.map((r) => ({
    id: r.w.id,
    walletId: r.wallet.id,
    who: `${r.name ?? ''} ${maskPhone(r.phone)}`.trim(),
    upiHint: r.wallet.upiHint,
    amountPaise: r.w.amountPaise,
    tdsPaise: r.w.tdsPaise,
    payPaise: r.w.amountPaise - r.w.tdsPaise,
    status: r.w.status,
    utr: r.w.utr,
    createdAt: r.w.createdAt.toISOString(),
  }));
}

// ---- Influencers ----

export async function influencerOf(db: Db | Tx, userId: string) {
  const [i] = await db.select().from(influencers).where(eq(influencers.userId, userId));
  return i ?? null;
}

export async function registerInfluencer(db: Db, user: SessionUser, input: InfluencerRegister) {
  return db.transaction(async (tx) => {
    if (await influencerOf(tx, user.id))
      throw new HttpError(409, 'already_influencer', 'You are already registered');
    await ensureWallet(tx, user.id, input.upiId);
    const code = await uniqueCode(
      tx,
      'DXI',
      async (c) =>
        !!(
          await tx.select({ id: influencers.id }).from(influencers).where(eq(influencers.code, c))
        )[0],
    );
    const [row] = await tx
      .insert(influencers)
      .values({
        userId: user.id,
        code,
        handle: input.handle,
        platform: input.platform,
        agreementVersion: TERMS_VERSIONS.influencer,
        agreementAcceptedAt: new Date(),
      })
      .returning();
    await tx
      .insert(termsAcceptances)
      .values({ userId: user.id, party: 'influencer', version: TERMS_VERSIONS.influencer })
      .onConflictDoNothing();
    await audit(tx, {
      actorUserId: user.id,
      action: 'influencer.register',
      entity: 'influencer',
      entityId: row!.id,
    });
    return row!;
  });
}

export async function influencerMe(db: Db, userId: string) {
  const i = await influencerOf(db, userId);
  if (!i) throw new HttpError(404, 'not_influencer', 'Register as an influencer first');
  const [r] = await db
    .select({
      referred: sql<number>`count(*)::int`,
      rewarded: sql<number>`count(*) filter (where ${referrals.status} = 'rewarded')::int`,
    })
    .from(referrals)
    .where(and(eq(referrals.referrerUserId, userId), eq(referrals.source, 'influencer')));
  const [a] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agents)
    .where(eq(agents.recruitedByInfluencerId, i.id));
  return {
    code: i.code,
    handle: i.handle,
    status: i.status,
    referred: r?.referred ?? 0,
    rewarded: r?.rewarded ?? 0,
    agentsRecruited: a?.n ?? 0,
    visits: i.linkVisits,
  };
}

/** Counts a visit to an influencer's /r/ link. Unknown or non-influencer codes are ignored. */
export async function recordLinkVisit(db: Db, code: string) {
  if (!code.startsWith('DXI-')) return;
  await db
    .update(influencers)
    .set({ linkVisits: sql`${influencers.linkVisits} + 1` })
    .where(and(eq(influencers.code, code), eq(influencers.status, 'active')));
}
