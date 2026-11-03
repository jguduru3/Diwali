// Shared pieces of the growth program: encrypted identity fields, balances, ledgers,
// notifications and shop events. Money rows are append-only and idempotent (G13).
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { financialYear, generateCode } from '@pataka/shared';
import type { Db } from '../../db/client';
import {
  agents,
  creditLedger,
  influencers,
  notifications,
  shopEvents,
  users,
  walletLedger,
  wallets,
} from '../../db/schema';
import { env } from '../env';
import { HttpError } from '../errors';
import { encryptSecret } from '../secrets';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** UPI ID: stored encrypted, a hash for "one wallet per UPI ID", and a hint like ra•••@okhdfc. */
export function protectUpi(upi: string) {
  const v = upi.trim().toLowerCase();
  const [name = '', bank = ''] = v.split('@');
  return {
    upiEnc: encryptSecret(v),
    upiHash: sha256(`upi:${v}`),
    upiHint: `${name.slice(0, 2)}•••@${bank}`,
  };
}

export function protectPan(pan: string) {
  const v = pan.trim().toUpperCase();
  return { panEnc: encryptSecret(v), panLast4: v.slice(-4) };
}

export const maskPhone = (p: string | null | undefined) =>
  p ? `${p.slice(0, 3)} •••••${p.slice(-4)}` : '';

/** A fresh code of this kind that is not in use (codes are permanent). */
export async function uniqueCode(
  db: DbOrTx,
  prefix: 'DXA' | 'DXI' | 'DXR',
  taken: (code: string) => Promise<boolean>,
): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateCode(prefix);
    if (!(await taken(code))) return code;
  }
  void db;
  throw new HttpError(503, 'code_unavailable', 'Could not create a code; try again');
}

// ---- Wallets (money for agents and influencers) ----

export async function walletOf(db: DbOrTx, userId: string) {
  const [w] = await db.select().from(wallets).where(eq(wallets.userId, userId));
  return w ?? null;
}

/** Creates the person's wallet with their UPI ID, or keeps the one they have. */
export async function ensureWallet(tx: Tx, userId: string, upiId: string) {
  const existing = await walletOf(tx, userId);
  if (existing) return existing;
  const p = protectUpi(upiId);
  const [clash] = await tx
    .select({ id: wallets.id })
    .from(wallets)
    .where(eq(wallets.upiHash, p.upiHash));
  if (clash)
    throw new HttpError(409, 'upi_in_use', 'This UPI ID is already linked to another wallet');
  const [w] = await tx
    .insert(wallets)
    .values({ userId, ...p })
    .returning();
  return w!;
}

export async function walletBalance(db: DbOrTx, walletId: string): Promise<number> {
  const [r] = await db
    .select({ s: sql<number>`coalesce(sum(${walletLedger.deltaPaise}), 0)::int` })
    .from(walletLedger)
    .where(eq(walletLedger.walletId, walletId));
  return r?.s ?? 0;
}

const EARNINGS = ['onboarding', 'referral_reward', 'recruit_reward'] as const;

/** Earnings this financial year, net of reversals (TDS and the PAN gate use this). */
export async function fyEarned(
  db: DbOrTx,
  walletId: string,
  fy = financialYear(),
): Promise<number> {
  const [r] = await db
    .select({ s: sql<number>`coalesce(sum(${walletLedger.deltaPaise}), 0)::int` })
    .from(walletLedger)
    .where(
      and(
        eq(walletLedger.walletId, walletId),
        eq(walletLedger.fy, fy),
        inArray(walletLedger.reason, [...EARNINGS, 'reversal']),
      ),
    );
  return r?.s ?? 0;
}

/** Adds one ledger row; a second call for the same (reason, ref) does nothing. */
export async function walletEntry(
  tx: Tx,
  walletId: string,
  reason: (typeof walletLedger.$inferInsert)['reason'],
  refId: string,
  deltaPaise: number,
): Promise<boolean> {
  const rows = await tx
    .insert(walletLedger)
    .values({ walletId, reason, refId, deltaPaise, fy: financialYear() })
    .onConflictDoNothing()
    .returning({ id: walletLedger.id });
  return rows.length > 0;
}

// ---- Customer credit ----

/** Credit is spent only before the season ends; after that the balance is zero. */
export const creditExpiresOn = () => env.seasonEndDate();

export async function creditBalance(db: DbOrTx, userId: string, now = new Date()): Promise<number> {
  if (now > env.seasonEndInstant()) return 0;
  const [r] = await db
    .select({ s: sql<number>`coalesce(sum(${creditLedger.deltaPaise}), 0)::int` })
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId));
  return Math.max(0, r?.s ?? 0);
}

export async function creditEntry(
  tx: Tx,
  userId: string,
  reason: (typeof creditLedger.$inferInsert)['reason'],
  refId: string,
  deltaPaise: number,
): Promise<boolean> {
  const rows = await tx
    .insert(creditLedger)
    .values({ userId, reason, refId, deltaPaise })
    .onConflictDoNothing()
    .returning({ id: creditLedger.id });
  return rows.length > 0;
}

/** Serialises balance checks for one person (credit holds, withdrawals). */
export async function lockUser(tx: Tx, userId: string) {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
}

// ---- G9: removing agent / influencer identity ----

/**
 * Clears a person's UPI ID, PAN, agent name and influencer handle (delete-me and the season
 * purge). Wallet and ledger rows stay as financial records, without anything that names them.
 */
export async function clearGrowthIdentity(tx: Tx, userIds: string[]) {
  if (!userIds.length) return;
  await tx
    .update(wallets)
    .set({
      upiEnc: encryptSecret('removed'),
      upiHash: sql`'removed:' || ${wallets.id}`,
      upiHint: '—',
      panEnc: null,
      panLast4: null,
      frozen: true,
      frozenReason: 'removed',
    })
    .where(inArray(wallets.userId, userIds));
  await tx.update(agents).set({ name: 'Removed' }).where(inArray(agents.userId, userIds));
  await tx
    .update(influencers)
    .set({ handle: 'removed' })
    .where(inArray(influencers.userId, userIds));
}

// ---- Events and notices ----

export async function shopEvent(
  db: DbOrTx,
  shopId: string,
  actorUserId: string | null,
  type: string,
  meta?: Record<string, unknown>,
) {
  await db.insert(shopEvents).values({ shopId, actorUserId, type, meta: meta ?? null });
}

export async function notify(
  db: DbOrTx,
  userId: string,
  type: string,
  params: Record<string, unknown> = {},
) {
  await db.insert(notifications).values({ userId, type, params });
}
