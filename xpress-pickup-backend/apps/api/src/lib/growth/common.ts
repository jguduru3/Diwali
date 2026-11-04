// Shared pieces of the growth program: encrypted identity fields, codes, notifications and
// shop events.
import { createHash } from 'node:crypto';
import { inArray, sql } from 'drizzle-orm';
import { generateCode } from '@pataka/shared';
import type { Db } from '../../db/client';
import { agents, notifications, shopEvents } from '../../db/schema';
import { HttpError } from '../errors';
import { encryptSecret } from '../secrets';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** UPI ID: stored encrypted, a hash for "one agent per UPI ID", and a hint like ra•••@okhdfc. */
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
  prefix: 'DXA',
  taken: (code: string) => Promise<boolean>,
): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateCode(prefix);
    if (!(await taken(code))) return code;
  }
  void db;
  throw new HttpError(503, 'code_unavailable', 'Could not create a code; try again');
}

// ---- G9: removing an agent's identity ----

/**
 * Clears an agent's name, UPI ID and PAN (delete-me and the season purge). Payout rows stay as
 * financial records, without anything that names the person.
 */
export async function clearGrowthIdentity(tx: Tx, userIds: string[]) {
  if (!userIds.length) return;
  await tx
    .update(agents)
    .set({
      name: 'Removed',
      upiEnc: encryptSecret('removed'),
      upiHash: sql`'removed:' || ${agents.id}`,
      upiHint: '—',
      panEnc: null,
      panLast4: null,
    })
    .where(inArray(agents.userId, userIds));
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
