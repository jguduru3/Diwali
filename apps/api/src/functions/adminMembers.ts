import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { assignRoleSchema, type AdminMembersResponse, type StaffMember } from '@pataka/shared';
import { getDb, type Db } from '../db/client';
import { clusterMarshals, clusters, shopMembers, shops, users } from '../db/schema';
import { audit } from '../lib/audit';
import { requireRole } from '../lib/auth';
import { HttpError } from '../lib/errors';
import { parseBody, route } from '../lib/http';
import { loadMemberships } from '../lib/members';

/** GET /api/console/members — every non-customer account, plus shops/clusters for the form. */
export async function listMembersHandler(
  req: HttpRequest,
  db: Db = getDb(),
): Promise<HttpResponseInit> {
  await requireRole(db, req, ['admin']);
  const staff = await db
    .select()
    .from(users)
    .where(and(ne(users.role, 'customer'), isNull(users.deletedAt)))
    .orderBy(asc(users.role), asc(users.phoneE164));
  const memberships = await loadMemberships(
    db,
    staff.map((u) => u.id),
  );
  const body: AdminMembersResponse = {
    members: staff.map((u) => ({
      userId: u.id,
      phone: u.phoneE164,
      displayName: u.displayName,
      role: u.role,
      memberships: memberships.get(u.id) ?? [],
    })),
    shops: await db
      .select({ id: shops.id, shortCode: shops.shortCode, name: shops.name })
      .from(shops)
      .orderBy(asc(shops.shortCode)),
    clusters: await db
      .select({ id: clusters.id, name: clusters.name })
      .from(clusters)
      .orderBy(asc(clusters.name)),
  };
  return { status: 200, jsonBody: body, headers: { 'Cache-Control': 'no-store' } };
}

/**
 * POST /api/console/members — give a phone number a role. Creates the user if the
 * number has never signed in. One membership per staff user; role "customer"
 * removes staff access. Revokes the user's existing sessions.
 */
export async function assignRoleHandler(
  req: HttpRequest,
  db: Db = getDb(),
): Promise<HttpResponseInit> {
  const admin = await requireRole(db, req, ['admin']);
  const input = await parseBody(req, assignRoleSchema);
  if (input.phone === admin.phoneE164 && input.role !== 'admin') {
    throw new HttpError(400, 'self_demote', 'You cannot remove your own admin role');
  }

  const member = await db.transaction(async (tx) => {
    let shopId: string | null = null;
    let clusterId: string | null = null;
    if (input.role === 'shop_owner' || input.role === 'shop_staff') {
      const [shop] = await tx
        .select({ id: shops.id })
        .from(shops)
        .where(eq(shops.shortCode, input.shopShortCode!));
      if (!shop) throw new HttpError(404, 'shop_not_found', 'No shop with that code');
      shopId = shop.id;
    }
    if (input.role === 'marshal') {
      const [cluster] = await tx
        .select({ id: clusters.id })
        .from(clusters)
        .where(eq(clusters.id, input.clusterId!));
      if (!cluster) throw new HttpError(404, 'cluster_not_found', 'No such cluster');
      clusterId = cluster.id;
    }

    let [user] = await tx.select().from(users).where(eq(users.phoneE164, input.phone)).limit(1);
    if (!user) {
      [user] = await tx.insert(users).values({ phoneE164: input.phone }).returning();
    }
    const userId = user!.id;
    await tx
      .update(users)
      .set({
        role: input.role,
        ...(input.displayName ? { displayName: input.displayName } : {}),
        tokenVersion: sql`${users.tokenVersion} + 1`,
      })
      .where(eq(users.id, userId));

    await tx.delete(shopMembers).where(eq(shopMembers.userId, userId));
    await tx.delete(clusterMarshals).where(eq(clusterMarshals.userId, userId));
    if (shopId) {
      await tx.insert(shopMembers).values({ shopId, userId, role: input.role });
    }
    if (clusterId) {
      await tx.insert(clusterMarshals).values({ clusterId, userId });
    }

    await audit(tx, {
      actorUserId: admin.id,
      action: 'admin.assign_role',
      entity: 'user',
      entityId: userId,
      meta: { role: input.role, shopId, clusterId },
    });
    return userId;
  });

  const [updated] = await db.select().from(users).where(eq(users.id, member));
  const body: StaffMember = {
    userId: member,
    phone: updated!.phoneE164,
    displayName: updated!.displayName,
    role: updated!.role,
    memberships: (await loadMemberships(db, [member])).get(member) ?? [],
  };
  return { status: 200, jsonBody: body };
}

app.http('adminMembers', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  // The Functions host reserves routes starting with "admin", so admin APIs live under /api/console.
  route: 'console/members',
  handler: route((req) =>
    req.method === 'POST' ? assignRoleHandler(req) : listMembersHandler(req),
  ),
});
