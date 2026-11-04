// Gate app (ground marshal): look up a customer's pickup QR at the ground
// entrance to send them to the right shop's Express Pickup counter. Read-only.
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { eq } from 'drizzle-orm';
import {
  formatOrderCode,
  gateAcknowledgeSchema,
  parseOrderQr,
  qrInputSchema,
  type GateLookup,
} from '@pataka/shared';
import { getDb } from '../db/client';
import { orders, shops } from '../db/schema';
import { requireCluster, requireUuidParam } from '../lib/access';
import { audit } from '../lib/audit';
import { HttpError } from '../lib/errors';
import { http, json, parseBody } from '../lib/http';
import { acknowledgeGateAssistance, gateAssistanceNotifications, hashSecret } from '../lib/orders';
import { clusterView } from '../lib/places';
import { rateLimit } from '../lib/rateLimit';

/** POST /api/gate/lookup {qr} */
export async function gateLookupHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, cluster } = await requireCluster(db, req);
  const { qr } = await parseBody(req, qrInputSchema);
  await rateLimit(db, `gate:${user.id}`, 120, 60);
  const parsed = parseOrderQr(qr);
  if (!parsed) {
    throw new HttpError(400, 'not_pickup_qr', "This isn't a customer pickup QR");
  }
  // The customer's phone shows the pack sticker's QR; an older customer-only QR still works.
  const hash = parsed.kind === 'pack' ? orders.packQrHash : orders.customerQrHash;
  const [row] = await db
    .select({ o: orders, shop: shops })
    .from(orders)
    .innerJoin(shops, eq(shops.id, orders.shopId))
    .where(eq(hash, hashSecret(parsed.secret)));
  if (!row) throw new HttpError(404, 'qr_not_found', 'Unknown or replaced QR');
  await audit(db, {
    actorUserId: user.id,
    action: 'gate.lookup',
    entity: 'order',
    entityId: row.o.id,
    meta: { clusterId: cluster.id },
  });
  const body: GateLookup = {
    code: formatOrderCode(row.o.code),
    status: row.o.status,
    shopCode: row.shop.shortCode,
    shopName: row.shop.name,
    packNo: row.o.packNo,
    sameGround: row.shop.clusterId === cluster.id,
  };
  return json(body);
}

/** GET /api/gate/today — the marshal's ground. */
export async function gateTodayHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { cluster } = await requireCluster(db, req);
  return json({ cluster: clusterView(cluster) });
}

/** GET /api/gate/notifications — active assistance notifications for this ground */
export async function gateNotificationsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { cluster } = await requireCluster(db, req);
  return json(await gateAssistanceNotifications(db, cluster.id));
}

/** POST /api/gate/orders/{id}/acknowledge {notes?} — gate marshal acknowledges assistance notification */
export async function gateAcknowledgeHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, cluster } = await requireCluster(db, req);
  const input = await parseBody(req, gateAcknowledgeSchema.optional());
  return json(
    await acknowledgeGateAssistance(db, cluster.id, user.id, requireUuidParam(req, 'id'), input),
  );
}

http('gateLookup', ['POST'], 'gate/lookup', gateLookupHandler);
http('gateToday', ['GET'], 'gate/today', gateTodayHandler);
http('gateNotifications', ['GET'], 'gate/notifications', gateNotificationsHandler);
http('gateAcknowledge', ['POST'], 'gate/orders/{id}/acknowledge', gateAcknowledgeHandler);
