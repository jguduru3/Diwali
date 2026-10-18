import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { eq, isNull, and, sql } from 'drizzle-orm';
import { getDb, type Db } from '../db/client';
import { clusterMarshals, consents, shopMembers, users } from '../db/schema';
import { audit } from '../lib/audit';
import { clearSessionCookie, requireUser } from '../lib/auth';
import { route } from '../lib/http';
import { toMe } from '../lib/members';

/** GET /api/me — 401 when signed out. */
export async function getMeHandler(req: HttpRequest, db: Db = getDb()): Promise<HttpResponseInit> {
  const user = await requireUser(db, req);
  return { status: 200, jsonBody: await toMe(db, user), headers: { 'Cache-Control': 'no-store' } };
}

/**
 * DELETE /api/me — self-service delete (G9): anonymise the phone, withdraw
 * consents, drop staff memberships, revoke sessions.
 */
export async function deleteMeHandler(
  req: HttpRequest,
  db: Db = getDb(),
): Promise<HttpResponseInit> {
  const user = await requireUser(db, req);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        phoneE164: `deleted:${user.id}`,
        displayName: null,
        role: 'customer',
        deletedAt: sql`now()`,
        tokenVersion: sql`${users.tokenVersion} + 1`,
      })
      .where(eq(users.id, user.id));
    await tx
      .update(consents)
      .set({ withdrawnAt: sql`now()` })
      .where(and(eq(consents.userId, user.id), isNull(consents.withdrawnAt)));
    await tx.delete(shopMembers).where(eq(shopMembers.userId, user.id));
    await tx.delete(clusterMarshals).where(eq(clusterMarshals.userId, user.id));
    await audit(tx, {
      actorUserId: user.id,
      action: 'user.delete_self',
      entity: 'user',
      entityId: user.id,
    });
  });
  return { status: 204, cookies: [clearSessionCookie()] };
}

app.http('me', {
  methods: ['GET', 'DELETE'],
  authLevel: 'anonymous',
  route: 'me',
  handler: route((req) => (req.method === 'DELETE' ? deleteMeHandler(req) : getMeHandler(req))),
});
