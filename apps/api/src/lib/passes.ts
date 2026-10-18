// Express Pass core (SPEC_V2 §4–5). The pass verifies the customer only; it
// never reserves stock or confirms a purchase (G10). Payment state changes only
// from signature-verified provider events, applied once per event id.
import { createHash, randomInt } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  PASS_ALPHABET,
  PASS_FEE_PAISE,
  PASS_REF_LENGTH,
  PASS_SECRET_LENGTH,
  effectivePassStatus,
  encodePassQr,
  formatPassRef,
  istDate,
  istDayRange,
  parsePassInput,
  passHolderMask,
  passValidTo,
  scanFlag,
  type Pass,
  type ScanFlag,
  type ScanResult,
  type VerifyResult,
} from '@pataka/shared';
import type { Db } from '../db/client';
import { passes, passScans, paymentEvents, payments, refunds, users } from '../db/schema';
import { audit } from './audit';
import { env } from './env';
import { HttpError } from './errors';
import { pgError } from './http';
import { activeProvider, type PaymentProvider, type ProviderEvent } from './payments';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type PassRow = typeof passes.$inferSelect;

/** An open checkout older than this gets a fresh attempt instead of being reused. */
export const CHECKOUT_REUSE_MINUTES = 30;

const randomCode = (n: number) =>
  Array.from({ length: n }, () => PASS_ALPHABET[randomInt(PASS_ALPHABET.length)]).join('');

export const newPassRef = () => randomCode(PASS_REF_LENGTH);
export const newPassSecret = () => randomCode(PASS_SECRET_LENGTH);
export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');
export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function passView(p: PassRow, openPayment: typeof payments.$inferSelect | null): Pass {
  return {
    id: p.id,
    ref: formatPassRef(p.ref),
    status: effectivePassStatus(p),
    feePaise: p.feePaise,
    validFrom: iso(p.validFrom),
    validTo: iso(p.validTo),
    createdAt: p.createdAt.toISOString(),
    checkout:
      p.status === 'pending_payment' && openPayment
        ? {
            provider: openPayment.provider,
            checkoutId: openPayment.checkoutId,
            url: openPayment.checkoutUrl,
          }
        : null,
  };
}

/** The customer's open pass, or else their most recent one (to show refunded/revoked). */
export async function currentPass(db: Db, userId: string) {
  const rows = await db
    .select()
    .from(passes)
    .where(eq(passes.userId, userId))
    .orderBy(desc(passes.createdAt))
    .limit(5);
  const pass = rows.find((p) => p.status === 'pending_payment' || p.status === 'active') ?? rows[0];
  if (!pass) return null;
  const [open] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.passId, pass.id), eq(payments.status, 'created')))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  return { pass, openPayment: open ?? null };
}

/**
 * Creates the customer's pass (or resumes the pending one) and returns a
 * payment attempt. Reuses a recent open checkout so retries never double-charge.
 */
export async function startPass(db: Db, userId: string): Promise<Pass> {
  if (!env.passesEnabled()) {
    throw new HttpError(403, 'passes_disabled', 'Express Pass is not available yet');
  }
  let current = await currentPass(db, userId);
  if (current && effectivePassStatus(current.pass) === 'active') {
    throw new HttpError(409, 'pass_active', 'You already have an active Express Pass');
  }
  if (!current || current.pass.status !== 'pending_payment') {
    for (let attempt = 0; ; attempt++) {
      try {
        const [row] = await db
          .insert(passes)
          .values({ userId, ref: newPassRef(), feePaise: PASS_FEE_PAISE })
          .returning();
        await audit(db, {
          actorUserId: userId,
          action: 'pass.create',
          entity: 'pass',
          entityId: row!.id,
        });
        current = { pass: row!, openPayment: null };
        break;
      } catch (err) {
        const e = pgError(err);
        // Reference collision (1 in ~10^12): try another.
        if (e?.code === '23505' && e.constraint === 'passes_ref_unique' && attempt < 3) continue;
        throw err;
      }
    }
  }
  const { pass, openPayment } = current;
  const fresh =
    openPayment &&
    Date.now() - openPayment.createdAt.getTime() < CHECKOUT_REUSE_MINUTES * 60_000;
  if (fresh) return passView(pass, openPayment);

  const provider = activeProvider();
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payments)
    .where(eq(payments.passId, pass.id));
  const idempotencyKey = `pass:${pass.id}:attempt:${n + 1}`;
  const checkout = await provider.createCheckout({
    idempotencyKey,
    amountPaise: pass.feePaise,
    passRef: formatPassRef(pass.ref),
  });
  const [payment] = await db
    .insert(payments)
    .values({
      passId: pass.id,
      provider: provider.name,
      checkoutId: checkout.checkoutId,
      checkoutUrl: checkout.url,
      amountPaise: pass.feePaise,
      idempotencyKey,
    })
    .returning();
  await audit(db, {
    actorUserId: userId,
    action: 'payment.create',
    entity: 'payment',
    entityId: payment!.id,
    meta: { provider: provider.name, passId: pass.id },
  });
  return passView(pass, payment!);
}

/** New QR secret for an active pass; the previous QR stops working at once. */
export async function rotateSecret(db: Db, userId: string): Promise<{ passId: string; qr: string }> {
  const current = await currentPass(db, userId);
  if (!current || effectivePassStatus(current.pass) !== 'active') {
    throw new HttpError(409, 'pass_not_active', 'You have no active Express Pass');
  }
  const secret = newPassSecret();
  await db
    .update(passes)
    .set({ secretHash: hashSecret(secret), secretRotatedAt: sql`now()` })
    .where(eq(passes.id, current.pass.id));
  await audit(db, {
    actorUserId: userId,
    action: 'pass.rotate_qr',
    entity: 'pass',
    entityId: current.pass.id,
  });
  return { passId: current.pass.id, qr: encodePassQr(secret) };
}

// ---- Provider events ----

export type EventOutcome =
  | 'duplicate'
  | 'activated'
  | 'captured_pass_not_pending'
  | 'already_captured'
  | 'amount_mismatch'
  | 'unknown_checkout'
  | 'payment_failed'
  | 'ignored'
  | 'refund_processed'
  | 'refund_failed'
  | 'unknown_refund';

/**
 * Applies one verified provider event. Idempotent: the event id is recorded in
 * the same transaction, so replays and delayed duplicates change nothing.
 */
export async function applyProviderEvent(
  db: Db,
  provider: string,
  event: ProviderEvent,
  rawBody: string,
  now = new Date(),
): Promise<EventOutcome> {
  return db.transaction(async (tx) => {
    const [recorded] = await tx
      .insert(paymentEvents)
      .values({
        provider,
        eventId: event.id,
        type: event.type,
        payloadSha256: sha256(rawBody),
        outcome: 'processing',
      })
      .onConflictDoNothing()
      .returning({ id: paymentEvents.id });
    if (!recorded) return 'duplicate';

    const outcome = await applyInTx(tx, provider, event, now);
    await tx.update(paymentEvents).set({ outcome }).where(eq(paymentEvents.id, recorded.id));
    await audit(tx, {
      actorUserId: null,
      action: `provider.${event.type}`,
      entity: 'payment_event',
      entityId: recorded.id,
      meta: { provider, eventId: event.id, outcome },
    });
    return outcome;
  });
}

async function applyInTx(
  tx: Tx,
  provider: string,
  event: ProviderEvent,
  now: Date,
): Promise<EventOutcome> {
  if (event.type === 'payment.captured' || event.type === 'payment.failed') {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.provider, provider), eq(payments.checkoutId, event.checkoutId)))
      .for('update');
    if (!payment) return 'unknown_checkout';
    if (event.amountPaise !== payment.amountPaise) return 'amount_mismatch';

    if (event.type === 'payment.failed') {
      if (payment.status !== 'created') return 'ignored';
      await tx
        .update(payments)
        .set({ status: 'failed', failedAt: now })
        .where(eq(payments.id, payment.id));
      return 'payment_failed';
    }

    if (payment.status === 'captured') return 'already_captured';
    // A late capture after a "failed" event still means the money arrived.
    await tx
      .update(payments)
      .set({ status: 'captured', providerPaymentId: event.paymentId, capturedAt: now })
      .where(eq(payments.id, payment.id));
    const [pass] = await tx
      .select()
      .from(passes)
      .where(eq(passes.id, payment.passId))
      .for('update');
    if (!pass || pass.status !== 'pending_payment') return 'captured_pass_not_pending';
    await tx
      .update(passes)
      .set({
        status: 'active',
        paidAt: now,
        validFrom: now,
        validTo: passValidTo(now, env.seasonEndDate(), env.passValidHours()),
      })
      .where(eq(passes.id, pass.id));
    return 'activated';
  }

  // refund.processed / refund.failed
  const [refund] = await tx
    .select({ r: refunds, p: payments })
    .from(refunds)
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .where(and(eq(payments.provider, provider), eq(refunds.providerRefundId, event.refundId)))
    .for('update');
  if (!refund) return 'unknown_refund';
  if (refund.r.status !== 'pending') return 'ignored';
  if (event.type === 'refund.processed') {
    await tx
      .update(refunds)
      .set({ status: 'processed', processedAt: now })
      .where(eq(refunds.id, refund.r.id));
    await tx.update(passes).set({ status: 'refunded' }).where(eq(passes.id, refund.p.passId));
    return 'refund_processed';
  }
  await tx.update(refunds).set({ status: 'failed' }).where(eq(refunds.id, refund.r.id));
  // Still not usable; the admin refund queue shows it for a retry.
  await tx
    .update(passes)
    .set({ status: 'revoked' })
    .where(and(eq(passes.id, refund.p.passId), eq(passes.status, 'refund_pending')));
  return 'refund_failed';
}

// ---- Admin actions ----

export async function revokePass(db: Db, passId: string, actorId: string, reason: string) {
  const [row] = await db
    .update(passes)
    .set({ status: 'revoked', revokedAt: sql`now()`, revokedBy: actorId, revokeReason: reason })
    .where(and(eq(passes.id, passId), inArray(passes.status, ['active', 'pending_payment'])))
    .returning();
  if (!row) throw new HttpError(409, 'not_revocable', 'Only open passes can be revoked');
  await audit(db, {
    actorUserId: actorId,
    action: 'pass.revoke',
    entity: 'pass',
    entityId: passId,
    meta: { reason },
  });
  return row;
}

/**
 * Full refund of the captured pass fee. The pass stops verifying at once
 * (refund_pending) and becomes refunded when the provider confirms.
 */
export async function refundPass(
  db: Db,
  passId: string,
  actorId: string,
  reason: string,
  provider: PaymentProvider = activeProvider(),
) {
  const { refund, payment } = await db.transaction(async (tx) => {
    const [pass] = await tx.select().from(passes).where(eq(passes.id, passId)).for('update');
    if (!pass) throw new HttpError(404, 'pass_not_found', 'No such pass');
    if (pass.status === 'refunded' || pass.status === 'refund_pending') {
      throw new HttpError(409, 'already_refunded', 'This pass is already refunded');
    }
    const [paid] = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.passId, passId),
          eq(payments.status, 'captured'),
          eq(payments.provider, provider.name),
          isNotNull(payments.providerPaymentId),
        ),
      )
      .orderBy(desc(payments.capturedAt))
      .limit(1);
    if (!paid) throw new HttpError(409, 'nothing_to_refund', 'This pass has no captured payment');
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(refunds)
      .where(eq(refunds.paymentId, paid.id));
    const [r] = await tx
      .insert(refunds)
      .values({
        paymentId: paid.id,
        amountPaise: paid.amountPaise,
        idempotencyKey: `refund:${paid.id}:${n + 1}`,
        reason,
        requestedBy: actorId,
      })
      .returning();
    await tx.update(passes).set({ status: 'refund_pending' }).where(eq(passes.id, passId));
    await audit(tx, {
      actorUserId: actorId,
      action: 'pass.refund_request',
      entity: 'pass',
      entityId: passId,
      meta: { reason, refundId: r!.id },
    });
    return { refund: r!, payment: paid };
  });

  const { refundId } = await provider.refund({
    paymentId: payment.providerPaymentId!,
    amountPaise: refund.amountPaise,
    idempotencyKey: refund.idempotencyKey,
  });
  await db.update(refunds).set({ providerRefundId: refundId }).where(eq(refunds.id, refund.id));
  return { ...refund, providerRefundId: refundId, providerPaymentId: payment.providerPaymentId! };
}

// ---- Verification ----

export type Place = { shopId: string; clusterId?: never } | { clusterId: string; shopId?: never };

const placeKey = (p: { shopId: string | null; clusterId: string | null }) =>
  p.shopId ? `shop:${p.shopId}` : `cluster:${p.clusterId}`;

function resultFor(pass: PassRow | undefined, now: Date): ScanResult {
  if (!pass) return 'not_found';
  switch (effectivePassStatus(pass, now)) {
    case 'active':
      return 'valid';
    case 'pending_payment':
      return 'not_paid';
    case 'expired':
      return 'expired';
    case 'revoked':
      return 'revoked';
    case 'refund_pending':
    case 'refunded':
      return 'refunded';
  }
}

/**
 * Checks a scanned or typed pass at a shop or ground and records the attempt.
 * Valid passes are never consumed: they work at any shop for the whole period.
 */
export async function verifyPass(
  db: Db,
  input: string,
  place: Place,
  staffId: string,
  now = new Date(),
): Promise<VerifyResult> {
  const secret = parsePassInput(input);
  const hash = secret ? hashSecret(secret) : null;

  return db.transaction(async (tx) => {
    const [found] = hash
      ? await tx
          .select({ pass: passes, phone: users.phoneE164 })
          .from(passes)
          .innerJoin(users, eq(users.id, passes.userId))
          .where(eq(passes.secretHash, hash))
      : [];
    const pass = found?.pass;
    if (pass) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${pass.id}))`);
    const result = resultFor(pass, now);

    let flag: ScanFlag | null = null;
    if (pass && result === 'valid') {
      const recent = await tx
        .select({ shopId: passScans.shopId, clusterId: passScans.clusterId, at: passScans.at })
        .from(passScans)
        .where(
          and(
            eq(passScans.passId, pass.id),
            eq(passScans.result, 'valid'),
            gte(passScans.at, new Date(now.getTime() - 86_400_000)),
          ),
        );
      flag = scanFlag(
        recent.map((r) => ({ placeKey: placeKey(r), at: r.at })),
        placeKey({ shopId: place.shopId ?? null, clusterId: place.clusterId ?? null }),
        now,
      );
    }

    const [scan] = await tx
      .insert(passScans)
      .values({
        passId: pass?.id ?? null,
        shopId: place.shopId ?? null,
        clusterId: place.clusterId ?? null,
        scannedBy: staffId,
        result,
        flag,
        at: now,
      })
      .returning({ id: passScans.id });
    await audit(tx, {
      actorUserId: staffId,
      action: 'pass.verify',
      entity: 'pass_scan',
      entityId: scan!.id,
      meta: { result, flag, ...place },
    });

    let scansToday = 0;
    if (pass) {
      const { from, to } = istDayRange(istDate(now));
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(passScans)
        .where(
          and(
            eq(passScans.passId, pass.id),
            eq(passScans.result, 'valid'),
            gte(passScans.at, from),
            sql`${passScans.at} < ${to.toISOString()}::timestamptz`,
          ),
        );
      scansToday = n;
    }

    return {
      result,
      flag,
      pass: pass
        ? {
            ref: formatPassRef(pass.ref),
            validTo: iso(pass.validTo),
            maskedPhone: passHolderMask(found!.phone),
            scansToday,
          }
        : null,
      scannedAt: now.toISOString(),
    };
  });
}
