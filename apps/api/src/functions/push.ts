// Web push subscriptions (SPEC_V3 §11). A subscription is tied to the signed-in
// user and one of the two apps; it is removed on sign-out, delete-me and purge.
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { pushSubscribeSchema, pushUnsubscribeSchema, PUSH_APPS } from '@pataka/shared';
import { z } from 'zod';
import { getDb, type Db } from '../db/client';
import { audit } from '../lib/audit';
import { requireUser } from '../lib/auth';
import { env } from '../lib/env';
import { http, json, parseBody } from '../lib/http';
import { queueTestPush, removeSubscription, saveSubscription } from '../lib/push';

/** GET /api/push/key — the VAPID public key, or null when push is not set up. */
export async function pushKeyHandler(): Promise<HttpResponseInit> {
  return json({ publicKey: env.vapid()?.publicKey ?? null });
}

/** POST /api/push/subscribe {endpoint, keys, app, lang} */
export async function pushSubscribeHandler(
  req: HttpRequest,
  db: Db = getDb(),
): Promise<HttpResponseInit> {
  const user = await requireUser(db, req);
  const input = await parseBody(req, pushSubscribeSchema);
  await saveSubscription(db, user.id, input);
  await audit(db, {
    actorUserId: user.id,
    action: 'push.subscribe',
    entity: 'user',
    entityId: user.id,
    meta: { app: input.app },
  });
  return json({ ok: true }, 201);
}

/** POST /api/push/unsubscribe {endpoint} */
export async function pushUnsubscribeHandler(
  req: HttpRequest,
  db: Db = getDb(),
): Promise<HttpResponseInit> {
  const user = await requireUser(db, req);
  const { endpoint } = await parseBody(req, pushUnsubscribeSchema);
  const removed = await removeSubscription(db, user.id, endpoint);
  await audit(db, {
    actorUserId: user.id,
    action: 'push.unsubscribe',
    entity: 'user',
    entityId: user.id,
    meta: { removed },
  });
  return json({ ok: true });
}

const testSchema = z.object({ app: z.enum(PUSH_APPS) }).strict();

/** POST /api/push/test {app} — a test notification to the caller's own devices. */
export async function pushTestHandler(
  req: HttpRequest,
  db: Db = getDb(),
): Promise<HttpResponseInit> {
  const user = await requireUser(db, req);
  const { app } = await parseBody(req, testSchema);
  await queueTestPush(db, user.id, app);
  await audit(db, { actorUserId: user.id, action: 'push.test', entity: 'user', entityId: user.id });
  return json({ ok: true });
}

http('pushKey', ['GET'], 'push/key', () => pushKeyHandler());
http('pushSubscribe', ['POST'], 'push/subscribe', (r) => pushSubscribeHandler(r));
http('pushUnsubscribe', ['POST'], 'push/unsubscribe', (r) => pushUnsubscribeHandler(r));
http('pushTest', ['POST'], 'push/test', (r) => pushTestHandler(r));
