// Agent payouts: ₹1,000 per shop that goes live, paid in full straight to the agent's own UPI
// ID (no wallet). An admin sends each transfer from the payout account and records its UTR.
// TDS as approved by the CA: PAN from ₹18,000 earned in a financial year, required from
// ₹20,000 (payouts wait for it), 2% on the part above ₹20,000 (G9, G13).
// Payout rows only move forward by compare-and-set: pending → sent | failed, failed → pending
// (retry), and pending | failed | sent → reversed.
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  AGENT_PAYOUT_PAISE,
  financialYear,
  panPrompt,
  payoutBlock,
  tdsFor,
  type AdminPayout,
  type AgentPayout,
} from '@pataka/shared';
import type { Db } from '../../db/client';
import { agentPayouts, agents, shops, users } from '../../db/schema';
import { audit } from '../audit';
import { HttpError } from '../errors';
import { maskPhone, notify, protectPan, protectUpi, type DbOrTx, type Tx } from './common';

type AgentRow = typeof agents.$inferSelect;
type PayoutRow = typeof agentPayouts.$inferSelect;

const counted = ne(agentPayouts.status, 'reversed');

/** What the agent earned in the financial year, reversed payouts excluded. */
export async function fyEarned(db: DbOrTx, agentId: string, fy = financialYear()) {
  const [r] = await db
    .select({
      earned: sql<number>`coalesce(sum(${agentPayouts.amountPaise}), 0)::int`,
      taxed: sql<number>`coalesce(sum(${agentPayouts.tdsBasePaise}), 0)::int`,
    })
    .from(agentPayouts)
    .where(and(eq(agentPayouts.agentId, agentId), eq(agentPayouts.fy, fy), counted));
  return { earned: r?.earned ?? 0, taxed: r?.taxed ?? 0 };
}

/** Why a pending payout cannot be sent yet (the PAN gate), or null. */
async function blockedFor(db: DbOrTx, agent: AgentRow, payout: PayoutRow) {
  if (payout.status !== 'pending') return null;
  const { earned } = await fyEarned(db, agent.id, payout.fy);
  return payoutBlock({ fyEarnedPaise: earned, hasPan: !!agent.panEnc });
}

/**
 * Records the ₹1,000 for a shop that just went live, once per shop, with its TDS worked out
 * against the agent's earnings this year. Runs inside the go-live transaction.
 */
export async function createPayout(tx: Tx, agent: AgentRow, shop: typeof shops.$inferSelect) {
  // Serialise one agent's payouts so two shops going live at once share the TDS threshold.
  await tx.select({ id: agents.id }).from(agents).where(eq(agents.id, agent.id)).for('update');
  const fy = financialYear();
  const { earned, taxed } = await fyEarned(tx, agent.id, fy);
  const tds = tdsFor({
    fyEarnedPaise: earned + AGENT_PAYOUT_PAISE,
    taxedBasePaise: taxed,
    amountPaise: AGENT_PAYOUT_PAISE,
  });
  const [payout] = await tx
    .insert(agentPayouts)
    .values({
      agentId: agent.id,
      shopId: shop.id,
      amountPaise: AGENT_PAYOUT_PAISE,
      fy,
      tdsPaise: tds.tdsPaise,
      tdsBasePaise: tds.basePaise,
    })
    .onConflictDoNothing()
    .returning();
  if (!payout) return null;
  await notify(tx, agent.userId, 'merchant.live', {
    shop: shop.name,
    amountPaise: AGENT_PAYOUT_PAISE - tds.tdsPaise,
  });
  await audit(tx, {
    actorUserId: null,
    action: 'payout.created',
    entity: 'agent_payout',
    entityId: payout.id,
    meta: { amountPaise: AGENT_PAYOUT_PAISE, tdsPaise: tds.tdsPaise },
  });
  return payout;
}

/** The agent's own payout list and this year's totals (for the agent page). */
export async function agentPayoutSummary(db: Db, agent: AgentRow) {
  const fy = financialYear();
  const { earned } = await fyEarned(db, agent.id, fy);
  const rows = await db
    .select({ p: agentPayouts, shopName: shops.name })
    .from(agentPayouts)
    .innerJoin(shops, eq(shops.id, agentPayouts.shopId))
    .where(eq(agentPayouts.agentId, agent.id))
    .orderBy(desc(agentPayouts.earnedAt))
    .limit(200);
  const net = (p: PayoutRow) => p.amountPaise - p.tdsPaise;
  const payouts: AgentPayout[] = [];
  for (const r of rows) {
    payouts.push({
      id: r.p.id,
      shopName: r.shopName,
      amountPaise: r.p.amountPaise,
      tdsPaise: r.p.tdsPaise,
      netPaise: net(r.p),
      status: r.p.status,
      utr: r.p.utr,
      blocked: await blockedFor(db, agent, r.p),
      failureReason: r.p.failureReason,
      earnedAt: r.p.earnedAt.toISOString(),
      sentAt: r.p.sentAt?.toISOString() ?? null,
    });
  }
  const hasPan = !!agent.panEnc;
  return {
    upiHint: agent.upiHint,
    fy,
    fyEarnedPaise: earned,
    paidPaise: rows.filter((r) => r.p.status === 'sent').reduce((s, r) => s + net(r.p), 0),
    pendingPaise: rows
      .filter((r) => r.p.status === 'pending' || r.p.status === 'failed')
      .reduce((s, r) => s + net(r.p), 0),
    panOnFile: hasPan,
    panPrompt: panPrompt({ fyEarnedPaise: earned, hasPan }),
    panRequired: payoutBlock({ fyEarnedPaise: earned, hasPan }) !== null,
    payouts,
  };
}

export async function setAgentPan(db: Db, agent: AgentRow, pan: string) {
  await db.update(agents).set(protectPan(pan)).where(eq(agents.id, agent.id));
  await audit(db, {
    actorUserId: agent.userId,
    action: 'agent.pan_set',
    entity: 'agent',
    entityId: agent.id,
  });
}

/** A new UPI ID for future transfers; failed payouts are queued again for it. */
export async function setAgentUpi(db: Db, agent: AgentRow, upiId: string) {
  const p = protectUpi(upiId);
  await db.transaction(async (tx) => {
    const [clash] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.upiHash, p.upiHash), ne(agents.id, agent.id)));
    if (clash) throw new HttpError(409, 'upi_in_use', 'This UPI ID belongs to another agent');
    await tx.update(agents).set(p).where(eq(agents.id, agent.id));
    await tx
      .update(agentPayouts)
      .set({ status: 'pending', failureReason: null })
      .where(and(eq(agentPayouts.agentId, agent.id), eq(agentPayouts.status, 'failed')));
    await audit(tx, {
      actorUserId: agent.userId,
      action: 'agent.upi_changed',
      entity: 'agent',
      entityId: agent.id,
    });
  });
}

// ---- Admin ----

/** Transfers to make (or made), with the UPI hint; the full UPI ID stays encrypted. */
export async function adminPayouts(
  db: Db,
  status: PayoutRow['status'] | null,
): Promise<AdminPayout[]> {
  const rows = await db
    .select({ p: agentPayouts, a: agents, phone: users.phoneE164, shop: shops })
    .from(agentPayouts)
    .innerJoin(agents, eq(agents.id, agentPayouts.agentId))
    .innerJoin(users, eq(users.id, agents.userId))
    .innerJoin(shops, eq(shops.id, agentPayouts.shopId))
    .where(status ? eq(agentPayouts.status, status) : undefined)
    .orderBy(desc(agentPayouts.earnedAt))
    .limit(500);
  const out: AdminPayout[] = [];
  for (const r of rows) {
    out.push({
      id: r.p.id,
      agentCode: r.a.code,
      agentName: r.a.name,
      phoneMasked: maskPhone(r.phone),
      upiHint: r.a.upiHint,
      shopCode: r.shop.shortCode,
      shopName: r.shop.name,
      amountPaise: r.p.amountPaise,
      tdsPaise: r.p.tdsPaise,
      netPaise: r.p.amountPaise - r.p.tdsPaise,
      status: r.p.status,
      utr: r.p.utr,
      blocked: await blockedFor(db, r.a, r.p),
      failureReason: r.p.failureReason,
      failedAttempts: r.p.failedAttempts,
      earnedAt: r.p.earnedAt.toISOString(),
    });
  }
  return out;
}

async function lockPayout(tx: Tx, id: string) {
  const [p] = await tx.select().from(agentPayouts).where(eq(agentPayouts.id, id)).for('update');
  if (!p) throw new HttpError(404, 'payout_not_found', 'No such payout');
  const [a] = await tx.select().from(agents).where(eq(agents.id, p.agentId));
  return { p, a: a! };
}

/** Admin: the transfer went out (UTR recorded). Refused while the PAN gate holds it. */
export async function markPayoutSent(db: Db, adminId: string, id: string, utr: string) {
  await db.transaction(async (tx) => {
    const { p, a } = await lockPayout(tx, id);
    if (p.status !== 'pending')
      throw new HttpError(409, 'bad_state', 'This payout is not waiting to be sent');
    if (await blockedFor(tx, a, p))
      throw new HttpError(409, 'pan_required', 'The agent must add their PAN before this payout');
    await tx
      .update(agentPayouts)
      .set({ status: 'sent', utr, sentAt: new Date(), decidedBy: adminId })
      .where(and(eq(agentPayouts.id, id), eq(agentPayouts.status, 'pending')));
    await notify(tx, a.userId, 'payout.sent', { amountPaise: p.amountPaise - p.tdsPaise, utr });
    await audit(tx, {
      actorUserId: adminId,
      action: 'payout.sent',
      entity: 'agent_payout',
      entityId: id,
      meta: { utr },
    });
  });
}

/** Admin: the transfer failed (for example a wrong UPI ID). The agent is asked to check it. */
export async function markPayoutFailed(db: Db, adminId: string, id: string, reason: string) {
  await db.transaction(async (tx) => {
    const { p, a } = await lockPayout(tx, id);
    if (p.status !== 'pending')
      throw new HttpError(409, 'bad_state', 'This payout is not waiting to be sent');
    await tx
      .update(agentPayouts)
      .set({
        status: 'failed',
        failureReason: reason,
        failedAttempts: sql`${agentPayouts.failedAttempts} + 1`,
        decidedBy: adminId,
      })
      .where(and(eq(agentPayouts.id, id), eq(agentPayouts.status, 'pending')));
    await notify(tx, a.userId, 'payout.failed', { amountPaise: p.amountPaise - p.tdsPaise });
    await audit(tx, {
      actorUserId: adminId,
      action: 'payout.failed',
      entity: 'agent_payout',
      entityId: id,
      meta: { reason },
    });
  });
}

/** Admin: try a failed transfer again (the agent confirmed their UPI ID). */
export async function retryPayout(db: Db, adminId: string, id: string) {
  const [p] = await db
    .update(agentPayouts)
    .set({ status: 'pending', failureReason: null })
    .where(and(eq(agentPayouts.id, id), eq(agentPayouts.status, 'failed')))
    .returning();
  if (!p) throw new HttpError(409, 'bad_state', 'Only a failed payout can be retried');
  await audit(db, {
    actorUserId: adminId,
    action: 'payout.retry',
    entity: 'agent_payout',
    entityId: id,
  });
}

/**
 * Admin: the shop's subscription was refunded or its licence failed. A payout not yet sent is
 * cancelled; one already sent is marked for recovery from the agent. The agent is suspended.
 */
export async function reversePayout(db: Db, adminId: string, id: string, reason: string) {
  await db.transaction(async (tx) => {
    const { p } = await lockPayout(tx, id);
    if (p.status === 'reversed') return;
    await tx
      .update(agentPayouts)
      .set({ status: 'reversed', reversedAt: new Date(), reversalReason: reason })
      .where(and(eq(agentPayouts.id, id), inArray(agentPayouts.status, [p.status])));
    await tx
      .update(agents)
      .set({ status: 'suspended', suspendedReason: reason })
      .where(eq(agents.id, p.agentId));
    await audit(tx, {
      actorUserId: adminId,
      action: 'payout.reversed',
      entity: 'agent_payout',
      entityId: id,
      meta: { reason, wasSent: p.status === 'sent' },
    });
  });
}
