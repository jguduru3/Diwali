import { eq, inArray } from 'drizzle-orm';
import type { Me, Membership } from '@pataka/shared';
import type { Db } from '../db/client';
import { clusterMarshals, clusters, shopMembers, shops } from '../db/schema';
import type { SessionUser } from './auth';

/** Shop and cluster memberships for each user id. */
export async function loadMemberships(
  db: Db,
  userIds: string[],
): Promise<Map<string, Membership[]>> {
  const out = new Map<string, Membership[]>(userIds.map((id) => [id, []]));
  if (userIds.length === 0) return out;

  const shopRows = await db
    .select({
      userId: shopMembers.userId,
      role: shopMembers.role,
      id: shops.id,
      name: shops.name,
      code: shops.shortCode,
    })
    .from(shopMembers)
    .innerJoin(shops, eq(shops.id, shopMembers.shopId))
    .where(inArray(shopMembers.userId, userIds));
  for (const r of shopRows) {
    out.get(r.userId)?.push({ kind: 'shop', id: r.id, name: r.name, code: r.code, role: r.role });
  }

  const clusterRows = await db
    .select({ userId: clusterMarshals.userId, id: clusters.id, name: clusters.name })
    .from(clusterMarshals)
    .innerJoin(clusters, eq(clusters.id, clusterMarshals.clusterId))
    .where(inArray(clusterMarshals.userId, userIds));
  for (const r of clusterRows) {
    out
      .get(r.userId)
      ?.push({ kind: 'cluster', id: r.id, name: r.name, code: null, role: 'marshal' });
  }
  return out;
}

export async function toMe(db: Db, user: SessionUser): Promise<Me> {
  const memberships = (await loadMemberships(db, [user.id])).get(user.id) ?? [];
  return {
    id: user.id,
    phone: user.phoneE164,
    displayName: user.displayName,
    role: user.role,
    memberships,
  };
}
