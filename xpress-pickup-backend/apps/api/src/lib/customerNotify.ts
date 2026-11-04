// Tells the customer when a shop changed their order while packing (an item out of stock, or
// an alternative offered) and is waiting for their answer. One SMS per order per gap window
// (ORDER_CHANGED_SMS_GAP_MINUTES), recorded as an order event. Sending never blocks packing:
// a failure is logged and recorded, and the in-app banner still shows the question.
import { and, desc, eq, gte } from 'drizzle-orm';
import { formatOrderCode } from '@pataka/shared';
import type { Db } from '../db/client';
import { orderEvents, orders, shops, users } from '../db/schema';
import { env } from './env';
import { orderEvent } from './orders';
import { smsSender } from './sms';

export type NotifyOutcome = 'sent' | 'skipped_recent' | 'skipped_status' | 'failed';

export async function notifyOrderChanged(
  db: Db,
  orderId: string,
  now = new Date(),
): Promise<NotifyOutcome> {
  const [row] = await db
    .select({ code: orders.code, status: orders.status, phone: users.phoneE164, shop: shops.name })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .innerJoin(shops, eq(shops.id, orders.shopId))
    .where(eq(orders.id, orderId));
  if (!row || row.status !== 'awaiting_customer') return 'skipped_status';

  const gap = env.orderChangedSmsGapMinutes();
  const since = new Date(now.getTime() - gap * 60_000);
  const [recent] = await db
    .select({ at: orderEvents.at })
    .from(orderEvents)
    .where(
      and(
        eq(orderEvents.orderId, orderId),
        eq(orderEvents.type, 'customer_notified'),
        gte(orderEvents.at, since),
      ),
    )
    .orderBy(desc(orderEvents.at))
    .limit(1);
  if (recent && gap > 0) return 'skipped_recent';

  const sender = smsSender();
  const link = `${env.publicOrigin().replace(/\/$/, '')}/orders/${orderId}`;
  try {
    const code = formatOrderCode(row.code);
    await sender.send(row.phone, 'order_changed', { shop: row.shop, code, link });
    await orderEvent(db, orderId, null, 'customer_notified', { channel: 'sms', via: sender.name });
    return 'sent';
  } catch (err) {
    console.error('order_changed SMS failed', (err as Error).message);
    await orderEvent(db, orderId, null, 'customer_notify_failed', {
      channel: 'sms',
      via: sender.name,
    });
    return 'failed';
  }
}
