// Demo mode (DEMO_MODE=true only): one-tap "view as" sign-in for existing
// accounts so every screen can be tried without SMS. Disabled → 404.
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { and, asc, eq, isNull, like } from 'drizzle-orm';
import { demoLoginSchema, type DemoAccount, type DemoInfo } from '@pataka/shared';
import { getDb } from '../db/client';
import { users } from '../db/schema';
import { audit } from '../lib/audit';
import { sessionCookie, signSession } from '../lib/auth';
import { env } from '../lib/env';
import { HttpError } from '../lib/errors';
import { http, json, parseBody } from '../lib/http';
import { loadMemberships, toMe } from '../lib/members';

/** Seeded demo numbers are +91 90000 000xx. */
const DEMO_PHONE_PATTERN = '+9190000000%';
const ROLE_ORDER = ['customer', 'shop_owner', 'shop_staff', 'marshal', 'admin'];

/** GET /api/auth/demo */
export async function demoInfoHandler(): Promise<HttpResponseInit> {
  if (!env.demoMode()) return json({ enabled: false, accounts: [] } satisfies DemoInfo);
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(and(like(users.phoneE164, DEMO_PHONE_PATTERN), isNull(users.deletedAt)))
    .orderBy(asc(users.phoneE164));
  const memberships = await loadMemberships(
    db,
    rows.map((r) => r.id),
  );
  const accounts: DemoAccount[] = rows
    .map((u) => ({
      phone: u.phoneE164,
      displayName: u.displayName,
      role: u.role,
      context:
        memberships
          .get(u.id)
          ?.map((m) => m.name)
          .join(', ') || null,
    }))
    .sort(
      (a, b) =>
        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
        // the clean demo customer (+91 90000 00099) first; queue visitors after
        (a.role === 'customer' ? b.phone.localeCompare(a.phone) : a.phone.localeCompare(b.phone)),
    );
  return json({ enabled: true, accounts } satisfies DemoInfo);
}

/** POST /api/auth/demo {phone} */
export async function demoLoginHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (!env.demoMode()) throw new HttpError(404, 'not_found', 'Not found');
  const db = getDb();
  const { phone } = await parseBody(req, demoLoginSchema);
  if (!phone.startsWith('+9190000000')) {
    throw new HttpError(403, 'forbidden', 'Only demo accounts can be used this way');
  }
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.phoneE164, phone), isNull(users.deletedAt)));
  if (!user) throw new HttpError(404, 'user_not_found', 'No demo account with that number');
  await audit(db, {
    actorUserId: user.id,
    action: 'auth.demo_login',
    entity: 'user',
    entityId: user.id,
  });
  const { token, ttl } = await signSession(user);
  return { status: 200, jsonBody: await toMe(db, user), cookies: [sessionCookie(token, ttl)] };
}

http('authDemoInfo', ['GET'], 'auth/demo', demoInfoHandler);
http('authDemoLogin', ['POST'], 'auth/demo/login', demoLoginHandler);
