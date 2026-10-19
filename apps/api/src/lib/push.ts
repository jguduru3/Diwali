// Web push (SPEC_V3 §11). Order changes write notifications to push_outbox in
// the same transaction; drainOutbox() sends them after the request (and from the
// minute timer as a backstop). Payloads carry no personal data (G9): only the
// shop's name and order/pack/bill numbers. Without VAPID keys nothing is sent.
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import webpush from 'web-push';
import {
  formatOrderCode,
  type OrderStatus,
  type PushApp,
  type PushKind,
  type PushPayload,
} from '@pataka/shared';
import type { Db } from '../db/client';
import { orders, pushOutbox, pushSubscriptions, shopMembers, shops } from '../db/schema';
import { env } from './env';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

type OrderRow = typeof orders.$inferSelect;
type SubRow = typeof pushSubscriptions.$inferSelect;

export type PushResult = 'sent' | 'gone' | 'failed';
export type PushSender = (sub: SubRow, payload: PushPayload) => Promise<PushResult>;

/** Sends with web-push and the VAPID keys. 404/410 = the browser dropped the subscription. */
const webPushSender: PushSender = async (sub, payload) => {
  const vapid = env.vapid();
  if (!vapid) return 'failed';
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      {
        vapidDetails: vapid,
        TTL: 6 * 3600,
        urgency: 'high',
        ...(payload.tag ? { topic: payload.tag.slice(0, 32) } : {}),
      },
    );
    return 'sent';
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? 'gone' : 'failed';
  }
};

let sender: PushSender = webPushSender;
/** Tests swap the sender; returns a restore function. */
export function setPushSender(next: PushSender): () => void {
  const prev = sender;
  sender = next;
  return () => {
    sender = prev;
  };
}

export function pushEnabled(): boolean {
  return sender !== webPushSender || env.vapid() !== null;
}

// ---- Queueing ----

/** Set when this process queued something; the request wrapper then drains. */
let queuedHere = false;

async function enqueue(
  tx: Db | Tx,
  userIds: string[],
  app: PushApp,
  kind: PushKind,
  url: string,
  params: Record<string, string | number>,
) {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  await tx.insert(pushOutbox).values(unique.map((userId) => ({ userId, app, kind, url, params })));
  queuedHere = true;
}

/** Staff of a shop who should hear about `kind`. */
async function shopRecipients(tx: Db | Tx, shopId: string, kind: PushKind) {
  const roles =
    kind === 'new_order'
      ? (['shop_owner', 'shop_staff'] as const)
      : (['shop_owner', 'shop_staff', 'shop_packer'] as const);
  const rows = await tx
    .select({ userId: shopMembers.userId })
    .from(shopMembers)
    .where(and(eq(shopMembers.shopId, shopId), inArray(shopMembers.role, [...roles])));
  return rows.map((r) => r.userId);
}

const CUSTOMER_KIND: Partial<Record<OrderStatus, PushKind>> = {
  confirmed: 'order_confirmed',
  awaiting_customer: 'order_needs_answer',
  packed: 'order_packed',
  completed: 'order_completed',
  rejected: 'order_rejected',
  expired: 'order_expired',
};

/**
 * Called by transition() inside its transaction: queues what the customer and the
 * shop should hear about this status change.
 */
export async function queueOrderPush(tx: Tx, before: OrderStatus, order: OrderRow): Promise<void> {
  const [shop] = await tx
    .select({ name: shops.name })
    .from(shops)
    .where(eq(shops.id, order.shopId));
  const params: Record<string, string | number> = {
    shop: shop?.name ?? '',
    code: formatOrderCode(order.code),
  };
  if (order.packNo != null) params.packNo = order.packNo;
  if (order.billNo) params.billNo = order.billNo;

  if (order.status === 'placed') {
    await enqueue(
      tx,
      await shopRecipients(tx, order.shopId, 'new_order'),
      'merchant',
      'new_order',
      '/shop',
      params,
    );
  }
  if (before === 'awaiting_customer' && order.status === 'packing') {
    await enqueue(
      tx,
      await shopRecipients(tx, order.shopId, 'customer_answered'),
      'merchant',
      'customer_answered',
      '/shop/packing',
      params,
    );
  }
  const kind = CUSTOMER_KIND[order.status];
  if (kind) await enqueue(tx, [order.userId], 'customer', kind, `/orders/${order.id}`, params);
}

/** A test notification to the caller's own devices for one app. */
export async function queueTestPush(db: Db, userId: string, app: PushApp) {
  await enqueue(db, [userId], app, 'test', app === 'merchant' ? '/merchant' : '/orders', {});
}

// ---- Sending ----

const MAX_ATTEMPTS = 5;
/** A notification that could not go out within this long is dropped, not sent late. */
const STALE_MS = 60 * 60 * 1000;

/**
 * Sends pending notifications. Safe to run concurrently: rows are claimed with
 * SKIP LOCKED. Returns how many were delivered to at least one device.
 */
export async function drainOutbox(db: Db, now = new Date(), limit = 100): Promise<number> {
  if (!pushEnabled()) return 0;
  await db
    .update(pushOutbox)
    .set({ sentAt: now })
    .where(
      and(isNull(pushOutbox.sentAt), lt(pushOutbox.createdAt, new Date(now.getTime() - STALE_MS))),
    );
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(pushOutbox)
      .where(and(isNull(pushOutbox.sentAt), lt(pushOutbox.attempts, MAX_ATTEMPTS)))
      .orderBy(asc(pushOutbox.createdAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    let delivered = 0;
    for (const row of rows) {
      const subs = await tx
        .select()
        .from(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, row.userId), eq(pushSubscriptions.app, row.app)));
      let ok = subs.length === 0; // nobody to tell: done
      let anySent = false;
      for (const sub of subs) {
        const result = await sender(sub, {
          kind: row.kind as PushKind,
          lang: sub.lang === 'te' ? 'te' : 'en',
          url: row.url,
          tag: `${row.kind}:${row.url}`,
          params: row.params as Record<string, string | number>,
        });
        if (result === 'gone') {
          await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
          ok = true;
        } else if (result === 'sent') {
          await tx
            .update(pushSubscriptions)
            .set({ lastSentAt: now })
            .where(eq(pushSubscriptions.id, sub.id));
          ok = true;
          anySent = true;
        }
      }
      if (anySent) delivered++;
      await tx
        .update(pushOutbox)
        .set(ok ? { sentAt: now } : { attempts: sql`${pushOutbox.attempts} + 1` })
        .where(eq(pushOutbox.id, row.id));
    }
    return delivered;
  });
}

/** After a request: send what it queued. Never fails the request. */
export async function drainQuietly(db: Db, log?: (err: unknown) => void) {
  if (!queuedHere) return;
  queuedHere = false;
  try {
    await drainOutbox(db);
  } catch (err) {
    log?.(err);
  }
}

// ---- Subscriptions ----

export async function saveSubscription(
  db: Db,
  userId: string,
  input: { endpoint: string; keys: { p256dh: string; auth: string }; app: PushApp; lang: string },
) {
  // An endpoint belongs to one browser; if someone else signs in there, it moves to them.
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      app: input.app,
      lang: input.lang,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        app: input.app,
        lang: input.lang,
      },
    });
}

export async function removeSubscription(db: Db, userId: string, endpoint: string) {
  const rows = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .returning({ id: pushSubscriptions.id });
  return rows.length;
}

export async function removeAllForUser(db: Db | Tx, userId: string) {
  await db.delete(pushOutbox).where(eq(pushOutbox.userId, userId));
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
}
